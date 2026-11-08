//! Service identity proof verification. Selection and secret are native inputs;
//! a response can never select a manifest, origin, environment, or proof version.
//! This does not enable service attachment or replace Direct's v1 verifier.
use super::{Hmac, Mac, Sha256, Value, HOST_PROOF_ERROR};
use serde_json::json;

const PROFILE: &str = "blackcrab-local-service-layout-v1";

fn hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Caller must obtain these arguments from verified private native selection,
/// never from the response, a renderer, discovery, or request headers.
pub(super) fn verify_service_host_proof(
    value: &Value,
    nonce: &str,
    environment: &str,
    origin: &str,
    secret: &str,
    selected_manifest: &str,
    selected_version: &str,
) -> Result<(), String> {
    let fail = || HOST_PROOF_ERROR.to_owned();
    let url = url::Url::parse(origin).map_err(|_| fail())?;
    if !hex(nonce)
        || !hex(secret)
        || !hex(selected_manifest)
        || environment.is_empty()
        || environment.len() > 128
        || environment.trim() != environment
        || environment.chars().any(|c| c.is_control())
        || selected_version.is_empty()
        || selected_version.len() > 128
        || selected_version.chars().any(|c| c.is_control())
        || url.as_str() != origin
        || super::validate_origin(origin, url.port_or_known_default().unwrap_or(0)).is_err()
        || value.as_object().map(|v| v.len()) != Some(10)
        || value["version"] != 2
        || value["nonce"] != nonce
        || value["environmentId"] != environment
        || value["origin"] != origin
        || value["serverVersion"] != selected_version
        || value["orchestrationProtocolVersion"] != 2
        || value["manifestSha256"] != selected_manifest
        || value["layoutProfile"] != PROFILE
        || value["serviceProtocol"] != 4
    {
        return Err(fail());
    }
    let proof = value["proof"]
        .as_str()
        .filter(|v| hex(v))
        .ok_or_else(fail)?;
    let mut bytes = [0u8; 32];
    for (i, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&proof[i * 2..i * 2 + 2], 16).map_err(|_| fail())?;
    }
    let message = serde_json::to_vec(&json!([
        "blackcrab-managed-host-proof-v2",
        nonce,
        environment,
        origin,
        selected_version,
        2,
        selected_manifest,
        PROFILE,
        4
    ]))
    .map_err(|_| fail())?;
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).map_err(|_| fail())?;
    mac.update(&message);
    mac.verify_slice(&bytes).map_err(|_| fail())
}

#[cfg(test)]
mod tests {
    use super::*;
    const ORIGIN: &str = "http://127.0.0.1:43123/";
    fn signed() -> Value {
        signed_origin(ORIGIN)
    }
    fn signed_origin(origin: &str) -> Value {
        let nonce = "a".repeat(64);
        let manifest = "c".repeat(64);
        let mut mac = Hmac::<Sha256>::new_from_slice("b".repeat(64).as_bytes()).unwrap();
        mac.update(
            serde_json::to_string(&json!([
                "blackcrab-managed-host-proof-v2",
                nonce,
                "legacy-env",
                origin,
                "0.1.7",
                2,
                manifest,
                PROFILE,
                4
            ]))
            .unwrap()
            .as_bytes(),
        );
        let proof: String = mac
            .finalize()
            .into_bytes()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        json!({"version":2,"nonce":nonce,"environmentId":"legacy-env","origin":origin,
            "serverVersion":"0.1.7","orchestrationProtocolVersion":2,"manifestSha256":manifest,
            "layoutProfile":PROFILE,"serviceProtocol":4,"proof":proof})
    }
    fn verify(value: &Value) -> Result<(), String> {
        verify_service_host_proof(
            value,
            &"a".repeat(64),
            "legacy-env",
            ORIGIN,
            &"b".repeat(64),
            &"c".repeat(64),
            "0.1.7",
        )
    }
    #[test]
    fn native_selected_service_proof_accepts_legacy_environment() {
        // Independent Node createHmac/JSON.stringify vector from the pinned codec.
        assert_eq!(
            signed()["proof"],
            "f49094a56ee5426748393b93695f50117171c5791d4095aaf978fb9f9335407e"
        );
        assert!(verify(&signed()).is_ok());
    }
    #[test]
    fn every_response_binding_is_checked_before_acceptance() {
        for (key, replacement) in [
            ("version", json!(1)),
            ("nonce", json!("d".repeat(64))),
            ("environmentId", json!("other")),
            ("origin", json!("http://127.0.0.1:43124/")),
            ("serverVersion", json!("0.1.8")),
            ("orchestrationProtocolVersion", json!(3)),
            ("manifestSha256", json!("d".repeat(64))),
            ("layoutProfile", json!("other")),
            ("serviceProtocol", json!(3)),
            ("proof", json!("0".repeat(64))),
        ] {
            let mut value = signed();
            value[key] = replacement;
            assert!(verify(&value).is_err(), "{key}");
        }
    }
    #[test]
    fn proof_shape_is_exact_and_hex_is_lowercase() {
        let valid = signed();
        for key in valid.as_object().unwrap().keys() {
            let mut value = valid.clone();
            value.as_object_mut().unwrap().remove(key);
            assert!(verify(&value).is_err(), "missing {key}");
        }
        let mut extra = valid.clone();
        extra["generation"] = json!(1);
        assert!(verify(&extra).is_err());
        for proof in [
            json!(null),
            json!(0),
            json!("a".repeat(63)),
            json!("A".repeat(64)),
            json!("é".repeat(32)),
        ] {
            let mut value = valid.clone();
            value["proof"] = proof;
            assert!(verify(&value).is_err());
        }
    }
    #[test]
    fn response_cannot_replace_native_selection_or_secret() {
        let value = signed();
        for (nonce, env, origin, secret, manifest, version) in [
            (
                "d".repeat(64),
                "legacy-env",
                ORIGIN,
                "b".repeat(64),
                "c".repeat(64),
                "0.1.7",
            ),
            (
                "a".repeat(64),
                "other",
                ORIGIN,
                "b".repeat(64),
                "c".repeat(64),
                "0.1.7",
            ),
            (
                "a".repeat(64),
                "legacy-env",
                "http://127.0.0.1:43124/",
                "b".repeat(64),
                "c".repeat(64),
                "0.1.7",
            ),
            (
                "a".repeat(64),
                "legacy-env",
                ORIGIN,
                "d".repeat(64),
                "c".repeat(64),
                "0.1.7",
            ),
            (
                "a".repeat(64),
                "legacy-env",
                ORIGIN,
                "b".repeat(64),
                "d".repeat(64),
                "0.1.7",
            ),
            (
                "a".repeat(64),
                "legacy-env",
                ORIGIN,
                "b".repeat(64),
                "c".repeat(64),
                "0.1.8",
            ),
        ] {
            assert!(verify_service_host_proof(
                &value, &nonce, env, origin, &secret, &manifest, version
            )
            .is_err());
        }
    }
    #[test]
    fn only_canonical_loopback_control_origins_are_accepted() {
        for origin in [
            "http://localhost:43123/",
            "http://0.0.0.0:43123/",
            "https://127.0.0.1:43123/",
            "http://127.0.0.1:43123",
            "http://127.0.0.1:43123/?x=1",
            "http://user@127.0.0.1:43123/",
            "http://127.0.0.1:43123/#x",
        ] {
            // A valid MAC must not legitimize a noncanonical/native-invalid origin.
            let value = signed_origin(origin);
            assert!(verify_service_host_proof(
                &value,
                &"a".repeat(64),
                "legacy-env",
                origin,
                &"b".repeat(64),
                &"c".repeat(64),
                "0.1.7"
            )
            .is_err());
        }
    }
    #[test]
    fn canonical_default_http_port_is_a_valid_selected_control_origin() {
        let origin = "http://127.0.0.1/";
        assert!(verify_service_host_proof(
            &signed_origin(origin),
            &"a".repeat(64),
            "legacy-env",
            origin,
            &"b".repeat(64),
            &"c".repeat(64),
            "0.1.7"
        )
        .is_ok());
    }
}
