use super::{api, parse, Package};
use serde_json::{json, Value};
use std::collections::HashSet;

/// Fetch all current package pages. Summary balances remain independent from package-detail availability.
pub(super) fn read(session: &Value, summary: &Value) -> Result<Vec<Package>, String> {
    let codes: Vec<&str> = summary["Packages"]
        .as_array()
        .ok_or("积分包汇总缺失")?
        .iter()
        .filter_map(|row| row["PackageCode"].as_str())
        .collect();
    if codes.is_empty() {
        return Ok(Vec::new());
    }
    let mut packages = Vec::new();
    let mut seen = HashSet::new();
    for kind in [1, 2] {
        let mut page = 1;
        let mut received = 0;
        loop {
            let body = json!({"PageNumber":page,"PageSize":200,"PackageCodes":codes,"Status":[0],"OnlyValidPeriod":true,"IsDisplayTotalInfo":true});
            let data = api::request(session, kind, &body)?;
            let rows = data["Accounts"].as_array().ok_or("积分包明细缺失")?;
            received += rows.len();
            for (index, row) in rows.iter().enumerate() {
                let id = row["ResourceId"]
                    .as_str()
                    .map(str::to_owned)
                    .or_else(|| row["ResourceId"].as_u64().map(|n| n.to_string()))
                    .unwrap_or_else(|| format!("{kind}-{page}-{index}"));
                if seen.insert(id.clone()) {
                    packages.push(parse_package(row, id));
                }
            }
            let total = data["TotalCount"]
                .as_u64()
                .or_else(|| data["TotalCount"].as_str()?.parse().ok());
            let more = total.map_or(rows.len() == 200, |count| received < count as usize);
            if !more {
                break;
            }
            if rows.is_empty() {
                return Err("积分包明细不完整".into());
            }
            page += 1;
        }
    }
    Ok(packages)
}

/// Parse resource expiry only; cycle reset/end timestamps are not treated as the package's expiry.
fn parse_package(row: &Value, id: String) -> Package {
    let overall =
        parse::number(&row["CapacitySizePrecise"]).or_else(|| parse::number(&row["CapacitySize"]));
    let (total, remaining) = if overall.is_some_and(|n| n > 0.) {
        (
            overall,
            parse::number(&row["CapacityRemainPrecise"])
                .or_else(|| parse::number(&row["CapacityRemain"])),
        )
    } else {
        (
            parse::number(&row["CycleCapacitySizePrecise"])
                .or_else(|| parse::number(&row["CycleCapacitySize"])),
            parse::number(&row["CycleCapacityRemainPrecise"])
                .or_else(|| parse::number(&row["CycleCapacityRemain"])),
        )
    };
    let reason = row["AccountAttributes"]
        .as_array()
        .and_then(|a| a.iter().find(|attr| attr["Key"] == "grantReason"))
        .and_then(|attr| attr["Value"].as_str())
        .filter(|s| !s.trim().is_empty());
    Package {
        id,
        name: reason
            .or_else(|| row["PackageName"].as_str())
            .unwrap_or("积分包")
            .into(),
        total,
        remaining,
        expires_at: parse_date(&row["DeductionEndTime"])
            .or_else(|| parse_date(&row["ExpiredTime"])),
    }
}

/// Interpret RFC3339, Unix timestamps and Tencent billing dates expressed in China standard time.
fn parse_date(value: &Value) -> Option<i64> {
    if let Some(raw) = value.as_i64().or_else(|| value.as_str()?.parse().ok()) {
        return (raw > 0).then_some(if raw >= 1_000_000_000_000 {
            raw / 1000
        } else {
            raw
        });
    }
    let text = value.as_str()?.trim();
    if let Ok(date) = chrono::DateTime::parse_from_rfc3339(text) {
        return Some(date.timestamp());
    }
    let date = chrono::NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S").ok()?;
    date.and_local_timezone(chrono::FixedOffset::east_opt(8 * 3600)?)
        .single()
        .map(|date| date.timestamp())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn package_expiry_is_not_cycle_end_and_unknown_values_stay_unknown() {
        let row = json!({"PackageName":"赠送积分","CapacitySizePrecise":"100","CapacityRemainPrecise":"25.5","ExpiredTime":"2026-11-13 20:00:00","CycleEndTime":"2026-11-12 20:00:00"});
        let p = parse_package(&row, "demo".into());
        assert_eq!(p.remaining, Some(25.5));
        assert_eq!(p.expires_at, parse_date(&json!("2026-11-13T12:00:00Z")));
        let p = parse_package(
            &json!({"CycleEndTime":"2026-11-12 20:00:00"}),
            "unknown".into(),
        );
        assert_eq!(p.expires_at, None);
        assert_eq!(p.remaining, None);
    }
}
