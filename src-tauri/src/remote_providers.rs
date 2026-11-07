//! Read-only discovery shared by authenticated LAN and encrypted relay clients.
//! Reports adapter capabilities separately from client readiness; never launches a CLI.
use crate::provider::{Provider, ProviderCapabilities, ProviderInfo};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProvidersRequest {
    #[serde(rename = "type")]
    kind: String,
    pub host_id: String,
    pub request_id: String,
}

impl ProvidersRequest {
    fn valid(&self) -> bool {
        self.kind == "providers_request"
            && !self.host_id.trim().is_empty()
            && self.host_id.chars().count() <= 1024
            && !self.request_id.is_empty()
            && self.request_id.len() <= 128
            && self.request_id.trim() == self.request_id
            && self.request_id.bytes().all(|b| (b' '..=b'~').contains(&b))
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    v: u8,
    msg: ProvidersRequest,
}

pub(crate) fn decode(plaintext: &str) -> Option<ProvidersRequest> {
    let envelope: Envelope = serde_json::from_str(plaintext).ok()?;
    (envelope.v == 1 && envelope.msg.valid()).then_some(envelope.msg)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteProvider {
    id: Provider,
    display_name: &'static str,
    installed: bool,
    desktop_ready: bool,
    remote_ready: bool,
    capabilities: ProviderCapabilities,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProvidersResult {
    #[serde(rename = "type")]
    kind: &'static str,
    host_id: String,
    request_id: String,
    ok: bool,
    error: Option<&'static str>,
    providers: Option<Vec<RemoteProvider>>,
}

pub(crate) fn execute(request: ProvidersRequest, host_id: &str) -> ProvidersResult {
    execute_with(request, host_id, crate::list_providers)
}

fn execute_with(
    request: ProvidersRequest,
    host_id: &str,
    discover: impl FnOnce() -> Vec<ProviderInfo>,
) -> ProvidersResult {
    let mut result = ProvidersResult {
        kind: "providers_result",
        host_id: host_id.into(),
        request_id: request.request_id.clone(),
        ok: false,
        error: None,
        providers: None,
    };
    if request.host_id != host_id || !request.valid() {
        result.error = Some("Provider request targets a different host or is invalid");
        return result;
    }
    result.providers = Some(
        discover()
            .into_iter()
            .map(|info| RemoteProvider {
                id: info.id,
                display_name: info.display_name,
                installed: info.installed,
                desktop_ready: info.client_ready,
                // Existing phone actions are Claude-only. Adapter support is not remote readiness.
                remote_ready: info.id == Provider::Claude && info.client_ready,
                capabilities: info.capabilities,
            })
            .collect(),
    );
    result.ok = true;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn request() -> serde_json::Value {
        json!({"v":1,"msg":{"type":"providers_request","hostId":"host","requestId":"read-1"}})
    }

    #[test]
    fn strict_decode_rejects_invalid_or_version_skewed_requests() {
        assert!(decode(&request().to_string()).is_some());
        for malformed in [
            json!({"v":2,"msg":request()["msg"]}),
            json!({"v":1,"msg":request()["msg"],"extra":true}),
            json!({"v":1,"msg":{"type":"providers_request","hostId":"host","requestId":"read-1","provider":"claude"}}),
        ] {
            assert!(decode(&malformed.to_string()).is_none());
        }
        for id in [
            String::new(),
            " leading".to_string(),
            "trailing ".to_string(),
            "new\nline".to_string(),
            "é".to_string(),
            "x".repeat(129),
        ] {
            let mut value = request();
            value["msg"]["requestId"] = json!(id);
            assert!(decode(&value.to_string()).is_none());
        }
        for host in [String::new(), "  ".to_string(), "x".repeat(1025)] {
            let mut value = request();
            value["msg"]["hostId"] = json!(host);
            assert!(decode(&value.to_string()).is_none());
        }
    }

    #[test]
    fn mismatched_host_rejects_before_discovery() {
        let result = execute_with(decode(&request().to_string()).unwrap(), "other", || {
            panic!("must not inspect installation")
        });
        let value = serde_json::to_value(result).unwrap();
        assert_eq!(value["hostId"], "other");
        assert_eq!(value["requestId"], "read-1");
        assert_eq!(value["ok"], false);
        assert!(value["providers"].is_null());
    }

    #[test]
    fn correlated_discovery_distinguishes_adapter_capabilities_and_client_readiness() {
        let result = execute_with(decode(&request().to_string()).unwrap(), "host", || {
            vec![Provider::Claude.info(false), Provider::Codex.info(true)]
        });
        let value = serde_json::to_value(result).unwrap();
        assert_eq!(value["type"], "providers_result");
        assert_eq!(value["hostId"], "host");
        assert_eq!(value["requestId"], "read-1");
        assert_eq!(value["ok"], true);
        assert!(value["error"].is_null());
        assert_eq!(value["providers"][0]["installed"], false);
        assert_eq!(value["providers"][0]["remoteReady"], true);
        assert_eq!(value["providers"][1]["id"], "codex");
        assert_eq!(value["providers"][1]["installed"], true);
        assert_eq!(value["providers"][1]["desktopReady"], false);
        assert_eq!(value["providers"][1]["remoteReady"], false);
        assert_eq!(value["providers"][1]["capabilities"]["resume"], true);
        assert!(value["providers"][1].get("executable").is_none());
    }
}
