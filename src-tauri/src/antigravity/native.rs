use serde_json::Value;
use std::ffi::{c_char, c_int, CStr, CString};

#[repr(i32)]
pub(super) enum LocalRoute {
    QuotaSummary = 0,
    UserStatus = 1,
}

extern "C" {
    fn cq_antigravity_local_post(
        port: c_int,
        route: c_int,
        csrf_token: *const c_char,
        status: *mut c_int,
    ) -> *mut c_char;
}

/// Send a loopback HTTPS POST to a local Antigravity language server and parse its JSON body.
pub(super) fn local_post(port: u16, route: LocalRoute, csrf_token: &str) -> Option<(i32, Value)> {
    let token = CString::new(csrf_token).ok()?;
    let mut status: c_int = 0;
    let raw = unsafe { cq_antigravity_local_post(port as c_int, route as c_int, token.as_ptr(), &mut status) };
    let body = if raw.is_null() {
        Value::Null
    } else {
        let parsed = unsafe { serde_json::from_slice(CStr::from_ptr(raw).to_bytes()) }
            .unwrap_or(Value::Null);
        unsafe { libc::free(raw.cast()) };
        parsed
    };
    (status > 0).then_some((status, body))
}
