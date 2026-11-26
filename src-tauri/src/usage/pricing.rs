/// Published public API token prices (USD per 1M tokens) for local cost estimation.
/// Unknown models return `None` rather than guessing $0.
#[derive(Debug, Clone, Copy)]
pub struct ModelPrice {
    pub input: f64,
    pub cache_read: f64,
    pub cache_write: f64,
    pub output: f64,
}

/// Match normalized model IDs against well-known public API pricing tiers.
pub fn lookup_price(model: &str) -> Option<ModelPrice> {
    let m = model.trim().to_ascii_lowercase();
    if m.is_empty() || m == "unknown" || m == "auto" {
        return None;
    }
    if m.contains("gpt-5-mini") || m.contains("gpt-5.1-mini") || m.contains("o4-mini") {
        return Some(ModelPrice {
            input: 0.25,
            cache_read: 0.025,
            cache_write: 0.25,
            output: 2.0,
        });
    }
    if m.contains("gpt-5-nano") {
        return Some(ModelPrice {
            input: 0.05,
            cache_read: 0.005,
            cache_write: 0.05,
            output: 0.4,
        });
    }
    if m.contains("gpt-5") || m.contains("codex") {
        return Some(ModelPrice {
            input: 1.25,
            cache_read: 0.125,
            cache_write: 1.25,
            output: 10.0,
        });
    }
    if m.contains("o3-mini") {
        return Some(ModelPrice {
            input: 1.1,
            cache_read: 0.55,
            cache_write: 1.1,
            output: 4.4,
        });
    }
    if m.contains("o3") {
        return Some(ModelPrice {
            input: 2.0,
            cache_read: 0.5,
            cache_write: 2.0,
            output: 8.0,
        });
    }
    if m.contains("gpt-4.1-mini") {
        return Some(ModelPrice {
            input: 0.4,
            cache_read: 0.1,
            cache_write: 0.4,
            output: 1.6,
        });
    }
    if m.contains("gpt-4.1") {
        return Some(ModelPrice {
            input: 2.0,
            cache_read: 0.5,
            cache_write: 2.0,
            output: 8.0,
        });
    }
    if m.contains("gpt-4o-mini") {
        return Some(ModelPrice {
            input: 0.15,
            cache_read: 0.075,
            cache_write: 0.15,
            output: 0.6,
        });
    }
    if m.contains("gpt-4o") {
        return Some(ModelPrice {
            input: 2.5,
            cache_read: 1.25,
            cache_write: 2.5,
            output: 10.0,
        });
    }
    if m.contains("gemini") && m.contains("flash") {
        return Some(ModelPrice {
            input: 0.3,
            cache_read: 0.075,
            cache_write: 0.3,
            output: 2.5,
        });
    }
    if m.contains("gemini") && (m.contains("pro") || m.contains("argon") || m.contains("neon")) {
        return Some(ModelPrice {
            input: 1.25,
            cache_read: 0.31,
            cache_write: 1.25,
            output: 10.0,
        });
    }
    if m.contains("claude") && m.contains("opus") {
        return Some(ModelPrice {
            input: 15.0,
            cache_read: 1.5,
            cache_write: 18.75,
            output: 75.0,
        });
    }
    if m.contains("claude") && m.contains("sonnet") {
        return Some(ModelPrice {
            input: 3.0,
            cache_read: 0.3,
            cache_write: 3.75,
            output: 15.0,
        });
    }
    if m.contains("claude") && m.contains("haiku") {
        return Some(ModelPrice {
            input: 0.8,
            cache_read: 0.08,
            cache_write: 1.0,
            output: 4.0,
        });
    }
    if m.contains("deepseek") {
        return Some(ModelPrice {
            input: 0.27,
            cache_read: 0.07,
            cache_write: 0.27,
            output: 1.1,
        });
    }
    if m.contains("glm") {
        return Some(ModelPrice {
            input: 0.6,
            cache_read: 0.15,
            cache_write: 0.6,
            output: 2.2,
        });
    }
    None
}

/// Compute USD cost from token buckets when the model has a published price tier.
pub fn estimate_usd(
    model: &str,
    input: i64,
    cache_read: i64,
    cache_write: i64,
    output: i64,
) -> Option<f64> {
    let price = lookup_price(model)?;
    let usd = (input.max(0) as f64 * price.input
        + cache_read.max(0) as f64 * price.cache_read
        + cache_write.max(0) as f64 * price.cache_write
        + output.max(0) as f64 * price.output)
        / 1_000_000.0;
    Some(usd)
}
