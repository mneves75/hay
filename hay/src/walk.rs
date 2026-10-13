use ignore::{WalkBuilder, types::TypesBuilder};
use std::path::Path;

pub(crate) struct Filters<'a> {
    pub hidden: bool,
    pub no_ignore: bool,
    pub types: &'a [String],
    pub types_not: &'a [String],
    pub globs: &'a [String],
    pub glob_root: Option<&'a Path>,
}

pub(crate) fn builder(root: &Path, filters: Filters<'_>) -> Result<WalkBuilder, String> {
    let mut builder = WalkBuilder::new(root);
    builder
        .hidden(!filters.hidden)
        .git_ignore(!filters.no_ignore)
        .git_global(false) // operator-local state must not change results
        .git_exclude(false) // .git/info/exclude is per-clone
        .ignore(false) // .ignore/.rgignore deliberately do not control hay
        .parents(!filters.no_ignore);
    if !filters.types.is_empty() || !filters.types_not.is_empty() {
        let mut types = TypesBuilder::new();
        types.add_defaults();
        for t in filters.types {
            types.select(t);
        }
        for t in filters.types_not {
            types.negate(t);
        }
        // Unknown types must fail, not silently select nothing and appear to find no matches.
        builder.types(types.build().map_err(|e| format!("bad file type: {e}"))?);
    }
    let cwd = std::env::current_dir().map_err(|e| format!("working directory: {e}"))?;
    let mut overrides = ignore::overrides::OverrideBuilder::new(filters.glob_root.unwrap_or(&cwd));
    // CLI globs are rooted at cwd, as in rg, not PATH (the old defect broke both include and
    // exclude). MCP explicitly roots filters at its requested canonical directory.
    // VCS exclusions are unanchored file-level globs, NOT a prune: a later user include wins,
    // including --hidden -g '.git/**'. Pruning first silently broke that documented contract.
    for vcs in ["!**/.git/**", "!**/.hg/**", "!**/.svn/**", "!**/.jj/**"] {
        overrides
            .add(vcs)
            .map_err(|e| format!("internal glob {vcs}: {e}"))?;
    }
    for glob in filters.globs {
        overrides
            .add(glob)
            .map_err(|e| format!("bad glob {glob}: {e}"))?;
    }
    builder.overrides(
        overrides
            .build()
            .map_err(|e| format!("bad glob set: {e}"))?,
    );
    Ok(builder)
}
