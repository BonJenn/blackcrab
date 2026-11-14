//! The inherited socket belongs to the captured workspace, never a discovered PID.
use serde::Deserialize;
use std::{
    io::{Read, Write},
    net::Shutdown,
    os::{fd::AsRawFd, unix::net::UnixStream},
    time::{Duration, Instant},
};

const LIMIT: usize = 1024;
fn error() -> String {
    "The workspace window did not respond. Close it and try again.".into()
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Reply {
    version: u32,
    id: u64,
    visible: bool,
}

pub(super) struct Channel {
    stream: UnixStream,
    next_id: u64,
    closed: bool,
}
impl Channel {
    pub(super) fn new(stream: UnixStream) -> Self {
        Self {
            stream,
            next_id: 1,
            closed: false,
        }
    }
    pub(super) fn close(&mut self) {
        self.closed = true;
        let _ = self.stream.shutdown(Shutdown::Both);
    }
    pub(super) fn activate(&mut self) -> Result<bool, String> {
        self.request(Duration::from_secs(3))
    }
    fn request(&mut self, timeout: Duration) -> Result<bool, String> {
        let result = self.exchange(timeout);
        // Never reuse a timed-out channel: a delayed response could be mistaken
        // for confirmation of a subsequent activation request.
        if result.is_err() {
            self.close();
        }
        result
    }
    fn exchange(&mut self, timeout: Duration) -> Result<bool, String> {
        if self.closed || self.next_id > 9_007_199_254_740_991 {
            return Err(error());
        }
        let id = self.next_id;
        self.next_id += 1;
        self.stream
            .set_write_timeout(Some(timeout))
            .map_err(|_| error())?;
        let deadline = Instant::now() + timeout;
        let request = format!("{{\"version\":1,\"id\":{id},\"action\":\"activate\"}}\n");
        self.stream
            .write_all(request.as_bytes())
            .map_err(|_| error())?;
        let mut frame = Vec::new();
        loop {
            let left = deadline
                .checked_duration_since(Instant::now())
                .filter(|d| !d.is_zero())
                .ok_or_else(error)?;
            // Poll against an absolute deadline instead of resetting socket
            // timeouts: Darwin refuses setsockopt after peer close even when
            // its final valid reply remains buffered and readable.
            let mut event = libc::pollfd {
                fd: self.stream.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            };
            let wait = left.as_millis().saturating_add(1).min(i32::MAX as u128) as i32;
            let result = unsafe { libc::poll(&mut event, 1, wait) };
            if result < 0
                && std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted
            {
                continue;
            }
            if result <= 0 || event.revents & libc::POLLNVAL != 0 {
                return Err(error());
            }
            let mut byte = [0u8; 1];
            match self.stream.read(&mut byte) {
                Ok(1) => {}
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                _ => return Err(error()),
            }
            if byte[0] == b'\n' {
                break;
            }
            frame.push(byte[0]);
            if frame.len() > LIMIT {
                return Err(error());
            }
        }
        let reply: Reply = serde_json::from_slice(&frame).map_err(|_| error())?;
        if reply.version != 1 || reply.id != id {
            return Err(error());
        }
        Ok(reply.visible)
    }
}
impl Drop for Channel {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(stream: &mut UnixStream) -> serde_json::Value {
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut bytes = Vec::new();
        loop {
            let mut b = [0];
            stream.read_exact(&mut b).unwrap();
            if b[0] == b'\n' {
                break;
            }
            bytes.push(b[0]);
        }
        serde_json::from_slice(&bytes).unwrap()
    }
    #[test]
    fn not_ready_then_visible_and_reopen_share_only_the_captured_channel() {
        let (root, mut client) = UnixStream::pair().unwrap();
        let worker = std::thread::spawn(move || {
            for (id, visible) in [(1, false), (2, true), (3, true)] {
                assert_eq!(
                    request(&mut client),
                    serde_json::json!({"version":1,"id":id,"action":"activate"})
                );
                writeln!(
                    client,
                    "{{\"version\":1,\"id\":{id},\"visible\":{visible}}}"
                )
                .unwrap();
            }
        });
        let mut channel = Channel::new(root);
        assert!(!channel.activate().unwrap());
        assert!(channel.activate().unwrap());
        assert!(channel.activate().unwrap());
        worker.join().unwrap();
        assert!(channel.activate().is_err());
    }
    #[test]
    fn foreign_malformed_and_oversized_replies_retire_the_channel() {
        for reply in [
            r#"{"version":1,"id":2,"visible":true}"#.to_string(),
            r#"{"version":1,"id":1,"visible":true,"pid":1}"#.into(),
            r#"{"version":1,"id":1,"visible":"true"}"#.into(),
            "x".repeat(LIMIT + 1),
        ] {
            let (root, mut client) = UnixStream::pair().unwrap();
            let worker = std::thread::spawn(move || {
                request(&mut client);
                let _ = writeln!(client, "{reply}");
            });
            let mut channel = Channel::new(root);
            assert!(channel.activate().is_err());
            assert!(channel.closed);
            assert!(channel.activate().is_err());
            worker.join().unwrap();
        }
    }
    #[test]
    fn a_silent_child_times_out_and_cannot_acknowledge_a_later_request() {
        let (root, mut client) = UnixStream::pair().unwrap();
        let mut channel = Channel::new(root);
        let before = Instant::now();
        assert!(channel.request(Duration::from_millis(30)).is_err());
        assert!(before.elapsed() < Duration::from_secs(1));
        assert!(channel.activate().is_err());
        request(&mut client);
        let mut byte = [0];
        assert_eq!(client.read(&mut byte).unwrap(), 0);
    }
}
