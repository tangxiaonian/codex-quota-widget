use serde_json::Value;
use std::ffi::{c_char, c_int, c_void, CStr, CString};
extern "C" {
    fn cq_workbuddy_json(
        credentials: *const c_char,
        kind: c_int,
        body: *const c_char,
    ) -> *mut c_char;
    fn free(ptr: *mut c_void);
}
/// Query one of the three fixed read-only billing routes, keeping all credentials inside the backend.
pub(super) fn request(session: &Value, kind: i32, body: &Value) -> Result<Value, String> {
    let credentials =
        CString::new(serde_json::to_vec(session).map_err(|_| "WorkBuddy 登录解析失败")?)
            .map_err(|_| "WorkBuddy 登录解析失败")?;
    let body = CString::new(serde_json::to_vec(body).map_err(|_| "WorkBuddy 请求编码失败")?)
        .map_err(|_| "WorkBuddy 请求编码失败")?;
    let response: Value = unsafe {
        let ptr = cq_workbuddy_json(credentials.as_ptr(), kind, body.as_ptr());
        if ptr.is_null() {
            return Err("WorkBuddy 网络请求失败，请稍后重试".into());
        }
        let result = serde_json::from_slice(CStr::from_ptr(ptr).to_bytes());
        free(ptr.cast());
        result.map_err(|_| "WorkBuddy 返回了无法解析的数据")?
    };
    if let Some(status) = response["httpStatus"].as_i64() {
        return Err(if status == 401 || status == 403 {
            "WorkBuddy 登录已失效，请在客户端重新登录"
        } else {
            "WorkBuddy 服务暂时不可用，请稍后重试"
        }
        .into());
    }
    if response["code"]
        .as_i64()
        .is_some_and(|code| code != 0 && code != 200)
    {
        return Err("WorkBuddy 登录已失效或额度查询失败，请在客户端重新登录".into());
    }
    response
        .get("data")
        .cloned()
        .ok_or("WorkBuddy 响应缺少数据".into())
}
