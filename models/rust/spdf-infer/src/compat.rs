//! When are two vector spaces "the same space"? (models/COMPATIBILIDAD.md, spec RFC 0002)
//!
//! Contract rule (spec/CONTRACT.md §2): two spaces are compatible (one query vector serves
//! both) iff `provider`, `model`, `version`, `dims`, `normalized`, `truncated_from` and
//! `task_prefixes` are equal; the storage `dtype` may differ.
//!
//! What goes in `version` is what the bench decided: every engine/quantisation whose vectors
//! stay within the threshold of the reference writes the bare checkpoint revision
//! (`914f7f89`); the others write `914f7f89+<variant>` (e.g. `+q4`), which makes them a
//! different space under the contract rule. [`check`] reports that case as `Approximate`
//! so a reader can still offer search with a warning instead of refusing.

use crate::embed::Space;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Compat {
    /// Same space: vectors are interchangeable.
    Same,
    /// Same checkpoint, different engine variant (e.g. `+q4`): comparable, but rankings lose
    /// some fidelity. Re-embed the query with the stored variant when possible.
    Approximate(String),
    /// Not comparable.
    Incompatible(String),
}

/// Version string without the `+variant` suffix.
pub fn base_version(v: &Option<String>) -> Option<&str> {
    v.as_deref().map(|s| s.split('+').next().unwrap_or(s))
}

/// The contract rule, exactly.
pub fn is_compatible(stored: &Space, query: &Space) -> bool {
    matches!(check(stored, query), Compat::Same)
}

/// The contract rule, with a reason, and `Approximate` for engine variants of one checkpoint.
pub fn check(stored: &Space, query: &Space) -> Compat {
    use Compat::*;
    if stored.provider != query.provider || stored.model != query.model {
        return Incompatible(format!("model {}/{} differs from {}/{}", stored.provider, stored.model, query.provider, query.model));
    }
    if stored.dims != query.dims {
        return Incompatible(format!("dims {} vs {}", stored.dims, query.dims));
    }
    if stored.normalized != query.normalized {
        return Incompatible("normalisation differs".into());
    }
    if stored.truncated_from != query.truncated_from {
        return Incompatible(format!("truncated_from {:?} vs {:?}", stored.truncated_from, query.truncated_from));
    }
    if stored.task_prefixes != query.task_prefixes {
        return Incompatible("task prefixes differ".into());
    }
    if stored.version != query.version {
        if base_version(&stored.version) == base_version(&query.version) && stored.version.is_some() {
            return Approximate(format!(
                "same checkpoint, engine variants differ ({} vs {})",
                stored.version.as_deref().unwrap_or("-"),
                query.version.as_deref().unwrap_or("-")
            ));
        }
        return Incompatible(format!("version {:?} vs {:?}", stored.version, query.version));
    }
    Same
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::embed::embeddinggemma2_task_prefixes;

    fn sp(version: &str, dims: usize, dtype: &str) -> Space {
        Space {
            id: format!("embeddinggemma-2@{dims}"),
            provider: "google".into(),
            model: "embeddinggemma-2".into(),
            version: Some(version.into()),
            dims,
            dtype: dtype.into(),
            normalized: true,
            truncated_from: if dims < 768 { Some(768) } else { None },
            modalities: vec!["text".into()],
            task_prefixes: Some(embeddinggemma2_task_prefixes()),
        }
    }

    #[test]
    fn dtype_may_differ() {
        assert!(is_compatible(&sp("914f7f89", 768, "f32"), &sp("914f7f89", 768, "i8")));
    }
    #[test]
    fn dims_must_match() {
        assert!(!is_compatible(&sp("914f7f89", 768, "f32"), &sp("914f7f89", 256, "f32")));
    }
    #[test]
    fn variant_is_approximate() {
        assert!(matches!(check(&sp("914f7f89", 768, "f32"), &sp("914f7f89+q4", 768, "f32")), Compat::Approximate(_)));
        assert!(!is_compatible(&sp("914f7f89", 768, "f32"), &sp("914f7f89+q4", 768, "f32")));
    }
}
