//! Deadline-bounded private pipe I/O for the service issuer on Windows.
//!
//! The Unix issuer makes its inherited pipes non-blocking and polls them. An
//! anonymous Windows pipe handle inherited from the Node launcher is
//! synchronous: it cannot be polled or given a timeout. Each direction
//! therefore gets one thread that performs the blocking call, and the issuer
//! waits on a channel with its deadline. The reader takes one byte at a time,
//! so at most one byte beyond the current frame is ever taken from the pipe,
//! and it is held for the next read, never dropped.
//!
//! The logic is platform-neutral and tested everywhere; only opening the
//! process's own standard handles is Windows-specific.
use std::{
    io::{Read, Write},
    sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender},
    time::{Duration, Instant},
};

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Failure {
    /// The deadline passed before the transfer completed.
    Deadline,
    /// The pipe failed, or its thread is gone.
    Broken,
}

pub(super) struct PrivateInput {
    bytes: Receiver<Result<Option<u8>, ()>>,
    ended: bool,
}
impl PrivateInput {
    pub(super) fn new(mut source: impl Read + Send + 'static) -> Self {
        // Rendezvous: the thread reads the next byte only after the previous
        // one was taken, so nothing accumulates outside the pipe.
        let (send, bytes) = mpsc::sync_channel(0);
        std::thread::spawn(move || loop {
            let mut byte = [0u8; 1];
            let outcome = match source.read(&mut byte) {
                Ok(0) => Ok(None),
                Ok(_) => Ok(Some(byte[0])),
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                // A Windows pipe whose writer has closed reads as broken.
                Err(error) if error.kind() == std::io::ErrorKind::BrokenPipe => Ok(None),
                Err(_) => Err(()),
            };
            let last = !matches!(outcome, Ok(Some(_)));
            if send.send(outcome).is_err() || last {
                return;
            }
        });
        Self { bytes, ended: false }
    }
    /// The next byte, `None` at end of stream. Without a deadline it waits
    /// until the peer writes or closes.
    pub(super) fn read_byte(&mut self, deadline: Option<Instant>) -> Result<Option<u8>, Failure> {
        if self.ended {
            return Ok(None);
        }
        let received = match deadline {
            None => self.bytes.recv().map_err(|_| Failure::Broken)?,
            Some(deadline) => {
                let wait = deadline.saturating_duration_since(Instant::now());
                match self.bytes.recv_timeout(wait) {
                    Ok(value) => value,
                    Err(RecvTimeoutError::Timeout) => return Err(Failure::Deadline),
                    Err(RecvTimeoutError::Disconnected) => return Err(Failure::Broken),
                }
            }
        };
        match received {
            Ok(Some(byte)) => Ok(Some(byte)),
            Ok(None) => {
                self.ended = true;
                Ok(None)
            }
            Err(()) => Err(Failure::Broken),
        }
    }
}

pub(super) struct PrivateOutput {
    frames: SyncSender<Vec<u8>>,
    written: Receiver<bool>,
    failed: bool,
}
impl PrivateOutput {
    pub(super) fn new(mut sink: impl Write + Send + 'static) -> Self {
        let (frames, receive) = mpsc::sync_channel::<Vec<u8>>(0);
        let (send, written) = mpsc::channel();
        std::thread::spawn(move || {
            for frame in receive {
                let ok = sink.write_all(&frame).and_then(|_| sink.flush()).is_ok();
                if send.send(ok).is_err() || !ok {
                    return;
                }
            }
        });
        Self { frames, written, failed: false }
    }
    /// Writes the whole frame or fails. After any failure, including a missed
    /// deadline with the write still pending, the output is never used again:
    /// a late completion must not be mistaken for a later frame's.
    pub(super) fn write_frame(&mut self, frame: &[u8], timeout: Duration) -> Result<(), Failure> {
        if self.failed {
            return Err(Failure::Broken);
        }
        let outcome = if self.frames.send(frame.to_vec()).is_err() {
            Err(Failure::Broken)
        } else {
            match self.written.recv_timeout(timeout) {
                Ok(true) => Ok(()),
                Ok(false) | Err(RecvTimeoutError::Disconnected) => Err(Failure::Broken),
                Err(RecvTimeoutError::Timeout) => Err(Failure::Deadline),
            }
        };
        self.failed = outcome.is_err();
        outcome
    }
}

/// The process's own standard input and output, which must be pipes. The
/// handles belong to the process and are deliberately never closed here.
#[cfg(windows)]
pub(super) fn standard_pipes() -> Result<(PrivateInput, PrivateOutput), Failure> {
    use std::{fs::File, mem::ManuallyDrop, os::windows::io::FromRawHandle};
    use windows_sys::Win32::{
        Foundation::INVALID_HANDLE_VALUE,
        Storage::FileSystem::{GetFileType, FILE_TYPE_PIPE},
        System::Console::{GetStdHandle, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE},
    };
    struct Borrowed(ManuallyDrop<File>);
    impl Read for Borrowed {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            self.0.read(buffer)
        }
    }
    impl Write for Borrowed {
        fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
            self.0.write(buffer)
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let open = |which| {
        let handle = unsafe { GetStdHandle(which) };
        if handle.is_null()
            || handle == INVALID_HANDLE_VALUE
            || unsafe { GetFileType(handle) } != FILE_TYPE_PIPE
        {
            return Err(Failure::Broken);
        }
        // Unbuffered: std's own stdin would read ahead of the current frame.
        Ok(Borrowed(ManuallyDrop::new(unsafe { File::from_raw_handle(handle) })))
    };
    Ok((
        PrivateInput::new(open(STD_INPUT_HANDLE)?),
        PrivateOutput::new(open(STD_OUTPUT_HANDLE)?),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn soon(millis: u64) -> Option<Instant> {
        Some(Instant::now() + Duration::from_millis(millis))
    }

    #[test]
    fn bytes_arrive_in_order_and_a_quiet_pipe_misses_only_its_deadline() {
        let (reader, mut writer) = std::io::pipe().unwrap();
        let mut input = PrivateInput::new(reader);
        assert_eq!(input.read_byte(soon(100)), Err(Failure::Deadline));
        writer.write_all(b"ab").unwrap();
        // The byte the thread was already waiting for is not lost by the miss.
        assert_eq!(input.read_byte(soon(5000)), Ok(Some(b'a')));
        assert_eq!(input.read_byte(soon(5000)), Ok(Some(b'b')));
        assert_eq!(input.read_byte(soon(100)), Err(Failure::Deadline));
        writer.write_all(b"c").unwrap();
        assert_eq!(input.read_byte(None), Ok(Some(b'c')));
        drop(writer);
        assert_eq!(input.read_byte(soon(5000)), Ok(None));
        assert_eq!(input.read_byte(soon(5000)), Ok(None));
    }

    #[test]
    fn a_frame_is_written_whole_and_a_stalled_reader_retires_the_output() {
        let (mut reader, writer) = std::io::pipe().unwrap();
        let mut output = PrivateOutput::new(writer);
        output.write_frame(b"{\"type\":\"ready\"}\n", Duration::from_secs(5)).unwrap();
        let mut received = [0u8; 17];
        reader.read_exact(&mut received).unwrap();
        assert_eq!(&received, b"{\"type\":\"ready\"}\n");
        // Far more than any pipe buffer, with nobody reading.
        let large = vec![b'x'; 8 * 1024 * 1024];
        assert_eq!(output.write_frame(&large, Duration::from_millis(300)), Err(Failure::Deadline));
        // Even a frame that would now fit is refused.
        assert_eq!(output.write_frame(b"late\n", Duration::from_secs(5)), Err(Failure::Broken));
        drop(reader);
    }

    #[test]
    fn a_closed_reader_fails_the_write_instead_of_hanging() {
        let (reader, writer) = std::io::pipe().unwrap();
        let mut output = PrivateOutput::new(writer);
        drop(reader);
        assert_eq!(output.write_frame(b"frame\n", Duration::from_secs(5)), Err(Failure::Broken));
    }
}
