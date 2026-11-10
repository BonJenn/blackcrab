//! Bounded manager subprocess IO. Process control uses only the retained Child.
use std::{path::Path,process::{ExitStatus,Stdio},time::Duration};
use tokio::io::{AsyncRead,AsyncReadExt};
#[derive(Debug)]
pub(super) struct Output {pub(super) status: ExitStatus,pub(super) stdout:Vec<u8>,pub(super) stderr:Vec<u8>}
async fn read_limited(reader: impl AsyncRead+Unpin, maximum:usize)->Result<Vec<u8>,String>{
    let mut bytes=Vec::new();reader.take(maximum as u64+1).read_to_end(&mut bytes).await.map_err(|_|"Service-manager output failed".to_owned())?;
    if bytes.len()>maximum{return Err("Service-manager output exceeded its limit".into());}Ok(bytes)
}
async fn run_tool(program:&Path,args:&[String],home:&Path,timeout:Duration,maximum:usize)->Result<Output,String>{
    let mut child=tokio::process::Command::new(program).args(args).env_clear()
        .env("PATH","/usr/bin:/bin:/usr/sbin:/sbin").env("HOME",home).env("LANG","C").env("LC_ALL","C")
        .current_dir(home).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .kill_on_drop(true).spawn().map_err(|_|"Could not start the service manager".to_owned())?;
    let Some(stdout)=child.stdout.take() else {let _=child.kill().await;let _=child.wait().await;return Err("Service-manager stdout unavailable".into());};
    let Some(stderr)=child.stderr.take() else {let _=child.kill().await;let _=child.wait().await;return Err("Service-manager stderr unavailable".into());};
    let completion={
        let joined=async {tokio::try_join!(async{child.wait().await.map_err(|_|"Service-manager wait failed".to_owned())},read_limited(stdout,maximum),read_limited(stderr,maximum))};
        tokio::time::timeout(timeout,joined).await
    };
    match completion{
        Ok(Ok((status,stdout,stderr)))=>Ok(Output{status,stdout,stderr}),
        result=>{
            // Never import a PID or signal a discovered service process. Reap
            // this exact manager child after timeout or failed bounded IO.
            let _=child.kill().await;let _=child.wait().await;
            match result{Ok(Err(error))=>Err(error),_=>Err("Service-manager request timed out".into())}
        }
    }
}
pub(super) async fn launchctl(args:&[String],home:&Path,timeout:Duration)->Result<Output,String>{
    run_tool(Path::new("/bin/launchctl"),args,home,timeout,64*1024).await
}
#[cfg(test)]
mod tests{
    use super::*;
    async fn python(code:&str,timeout:Duration,maximum:usize)->Result<Output,String>{
        run_tool(Path::new("/usr/bin/python3"),&["-I".into(),"-c".into(),code.into()],&std::env::temp_dir(),timeout,maximum).await
    }
    #[tokio::test]
    async fn actual_child_output_is_bounded_and_success_is_reaped(){
        let output=python("print('bounded')",Duration::from_secs(5),128).await.unwrap();
        assert!(output.status.success());assert_eq!(output.stdout,b"bounded\n");assert!(output.stderr.is_empty());
        assert!(python("print('x'*4096)",Duration::from_secs(5),128).await.unwrap_err().contains("limit"));
    }
    #[tokio::test]
    async fn timeout_kills_and_reaps_only_the_captured_child(){
        let start=std::time::Instant::now();
        let error=python("import time; time.sleep(30)",Duration::from_millis(100),128).await.err().unwrap();
        assert!(error.contains("timed out"));assert!(start.elapsed()<Duration::from_secs(5));
    }
}
