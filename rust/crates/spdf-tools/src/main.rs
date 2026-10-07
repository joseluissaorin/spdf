//! `spdf`: command-line tool for SPDF files.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Args, Parser, Subcommand};
use serde_json::{json, Value};
use spdf::{Anchor, AnchorUri, Locale, OpenOptions, Spdf, Target};

#[derive(Parser)]
#[command(
    name = "spdf",
    version,
    about = "SPDF (Semantic Processed Document Format) tool"
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Validate a file and print the report (exit 1 if invalid).
    Validate {
        file: PathBuf,
        /// Print JSON instead of a summary.
        #[arg(long)]
        json: bool,
    },
    /// Print the canonical JSON dump (RFC 8785).
    Dump {
        file: PathBuf,
        /// Indented output (not canonical).
        #[arg(long)]
        pretty: bool,
    },
    /// Summary of a file.
    Info { file: PathBuf },
    /// Search a file.
    Search(SearchArgs),
    /// Short citation of a fragment or an anchor.
    Cite {
        file: PathBuf,
        /// Fragment id.
        #[arg(long, conflicts_with = "anchor")]
        fragment: Option<String>,
        /// Anchor JSON.
        #[arg(long)]
        anchor: Option<String>,
        /// End anchor JSON (ranges).
        #[arg(long)]
        end: Option<String>,
        /// es | en
        #[arg(long, default_value = "es")]
        locale: String,
    },
    /// Parse or format anchor URIs.
    Anchor {
        #[command(subcommand)]
        op: AnchorOp,
    },
    /// Export bibliography data.
    Export {
        file: PathBuf,
        /// CSL-JSON (default).
        #[arg(long)]
        csl: bool,
        /// BibTeX.
        #[arg(long)]
        bibtex: bool,
    },
    /// Convert a legacy 4.x file to 5.0.
    Convert { src: PathBuf, dst: PathBuf },
    /// Build a 5.0 file from a canonical dump (or a conformance source).
    BuildFromDump { dump: PathBuf, out: PathBuf },
    /// Create an Ed25519 key pair (`<prefix>.key` secret, `<prefix>.pub`).
    Keygen { prefix: PathBuf },
    /// Write a copy with content_sha256 and an Ed25519 signature.
    Sign {
        src: PathBuf,
        dst: PathBuf,
        /// Secret key file (base64 seed). Without it, only the hash is set.
        #[arg(long)]
        key: Option<PathBuf>,
    },
    /// Check content_sha256 and the signature.
    Verify {
        file: PathBuf,
        /// Expected signer (`ed25519:<base64>`) or a `.pub` file.
        #[arg(long)]
        signer: Option<String>,
    },
    /// Run the conformance suite in <dir> and print the protocol JSON.
    Conformance {
        dir: PathBuf,
        /// Only cases whose id contains this text.
        #[arg(long)]
        filter: Option<String>,
    },
}

#[derive(Args)]
struct SearchArgs {
    file: PathBuf,
    /// Lexical query.
    #[arg(long)]
    lexical: Option<String>,
    /// Hybrid query (needs --vector-file and --space).
    #[arg(long)]
    hybrid: Option<String>,
    /// Query vector: JSON array, or raw little-endian f32.
    #[arg(long)]
    vector_file: Option<PathBuf>,
    /// Vector space id.
    #[arg(long)]
    space: Option<String>,
    /// fragment | unit | figure (vector search).
    #[arg(long, default_value = "fragment")]
    target: String,
    #[arg(long, default_value_t = 10)]
    limit: usize,
}

#[derive(Subcommand)]
enum AnchorOp {
    /// Parse a URI and print {docref, locator}.
    Parse { uri: String },
    /// Format a URI from an anchor JSON (or a locator JSON).
    Format {
        /// Document reference (`sha256-<hex>` or id).
        #[arg(long)]
        docref: String,
        /// Anchor JSON.
        #[arg(long, conflicts_with = "locator")]
        anchor: Option<String>,
        /// End anchor JSON.
        #[arg(long)]
        end: Option<String>,
        /// Locator JSON (as printed by `parse`).
        #[arg(long)]
        locator: Option<String>,
    },
}

type Res<T> = Result<T, Box<dyn std::error::Error>>;

fn print_json(v: &Value) {
    println!("{}", serde_json::to_string_pretty(v).unwrap_or_default());
}

fn open(path: &PathBuf) -> Res<Spdf> {
    Ok(Spdf::open(path)?)
}

fn read_vector(path: &PathBuf) -> Res<Vec<f32>> {
    let bytes = std::fs::read(path)?;
    if let Ok(v) = serde_json::from_slice::<Value>(&bytes) {
        let arr = v
            .as_array()
            .or_else(|| v.get("vector").and_then(Value::as_array))
            .ok_or("vector JSON must be an array")?;
        return arr
            .iter()
            .map(|x| {
                x.as_f64()
                    .map(|f| f as f32)
                    .ok_or_else(|| "non-numeric component".into())
            })
            .collect();
    }
    if bytes.len() % 4 != 0 {
        return Err("raw vector file size is not a multiple of 4".into());
    }
    Ok(bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect())
}

fn run(cli: Cli) -> Res<ExitCode> {
    match cli.cmd {
        Cmd::Validate { file, json } => {
            let r = spdf::validate(&file);
            if json {
                print_json(&serde_json::to_value(&r)?);
            } else {
                println!(
                    "{}: {} (SPDF {}, profile {})",
                    file.display(),
                    if r.valid { "valid" } else { "INVALID" },
                    r.version.as_deref().unwrap_or("?"),
                    r.profile.join(" ")
                );
                for e in &r.errors {
                    println!("  error   {} {} [{}]", e.code, e.message, e.r#where);
                }
                for w in &r.warnings {
                    println!("  warning {} {} [{}]", w.code, w.message, w.r#where);
                }
            }
            return Ok(if r.valid {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(1)
            });
        }
        Cmd::Dump { file, pretty } => {
            let opts = OpenOptions {
                ignore_required_extensions: true,
                ..Default::default()
            };
            let doc = Spdf::open_with(&file, &opts)?;
            if pretty {
                print_json(&doc.dump()?);
            } else {
                println!("{}", doc.dump_canonical()?);
            }
        }
        Cmd::Info { file } => {
            let doc = open(&file)?;
            let d = doc.document()?;
            let meta = doc.meta()?;
            let spaces: Vec<Value> = doc
                .spaces()?
                .iter()
                .map(|s| json!({"id": s.id, "dims": s.dims, "dtype": s.dtype}))
                .collect();
            print_json(&json!({
                "version": doc.version(),
                "legacy": doc.is_legacy(),
                "gzip": doc.was_gzip(),
                "profile": meta.get("profile"),
                "generator": meta.get("generator"),
                "document": {"id": d.id, "kind": d.kind, "title": d.title, "authors": d.authors,
                              "year": d.year, "language": d.language, "units": d.unit_count},
                "units": doc.units()?.len(),
                "fragments": doc.fragments()?.len(),
                "figures": doc.figures()?.len(),
                "sections": doc.sections()?.len(),
                "spaces": spaces,
                "blobs": doc.blobs()?.len(),
                "trigram": doc.has_trigram(),
            }));
        }
        Cmd::Search(a) => {
            let doc = open(&a.file)?;
            let hits = if let Some(q) = &a.lexical {
                doc.search_lexical(q, a.limit)?
            } else if let Some(q) = &a.hybrid {
                let v = read_vector(
                    a.vector_file
                        .as_ref()
                        .ok_or("--hybrid needs --vector-file")?,
                )?;
                let space = a.space.as_deref().ok_or("--hybrid needs --space")?;
                doc.search_hybrid(q, &v, space, a.limit)?
            } else if let Some(vf) = &a.vector_file {
                let v = read_vector(vf)?;
                let space = a.space.as_deref().ok_or("vector search needs --space")?;
                let target =
                    Target::parse(&a.target).ok_or("target must be fragment, unit or figure")?;
                doc.search_vector(space, &v, target, a.limit)?
            } else {
                return Err("use --lexical, --vector-file or --hybrid".into());
            };
            print_json(&serde_json::to_value(&hits)?);
        }
        Cmd::Cite {
            file,
            fragment,
            anchor,
            end,
            locale,
        } => {
            let doc = open(&file)?;
            let d = doc.document()?;
            let (a, e) = if let Some(id) = fragment {
                let f = doc.fragment(&id)?.ok_or("no such fragment")?;
                (f.parse_anchor()?, f.parse_anchor_end()?)
            } else {
                let a = Anchor::from_json(anchor.as_deref().ok_or("use --fragment or --anchor")?)?;
                let e = end.as_deref().map(Anchor::from_json).transpose()?;
                (a, e)
            };
            println!(
                "{}",
                spdf::cite_range(&a, e.as_ref(), &d, Locale::parse(&locale))
            );
        }
        Cmd::Anchor { op } => match op {
            AnchorOp::Parse { uri } => print_json(&serde_json::to_value(spdf::parse_uri(&uri)?)?),
            AnchorOp::Format {
                docref,
                anchor,
                end,
                locator,
            } => {
                if let Some(l) = locator {
                    let u = AnchorUri {
                        docref,
                        locator: serde_json::from_str(&l)?,
                    };
                    println!("{u}");
                } else {
                    let a: Value = serde_json::from_str(
                        anchor.as_deref().ok_or("use --anchor or --locator")?,
                    )?;
                    let e: Option<Value> = end.as_deref().map(serde_json::from_str).transpose()?;
                    println!("{}", spdf::format_uri(&docref, &a, e.as_ref())?);
                }
            }
        },
        Cmd::Export { file, csl, bibtex } => {
            let doc = open(&file)?;
            let d = doc.document()?;
            if bibtex && !csl {
                print!("{}", spdf::export::bibtex(&d));
            } else {
                print_json(&spdf::export::csl_json(&d));
            }
        }
        Cmd::Convert { src, dst } => {
            spdf::convert_legacy(&src, &dst)?;
            let r = spdf::validate(&dst);
            eprintln!(
                "{} -> {} ({})",
                src.display(),
                dst.display(),
                if r.valid { "valid 5.0" } else { "INVALID" }
            );
            if !r.valid {
                print_json(&serde_json::to_value(&r)?);
                return Ok(ExitCode::from(1));
            }
        }
        Cmd::BuildFromDump { dump, out } => {
            let v: Value = serde_json::from_slice(&std::fs::read(&dump)?)?;
            let mut w = spdf::Writer::from_dump(&v)?;
            w.write(&out)?;
            eprintln!("wrote {}", out.display());
        }
        Cmd::Keygen { prefix } => {
            let k = spdf::KeyPair::generate()?;
            let sk = prefix.with_extension("key");
            let pk = prefix.with_extension("pub");
            if sk.exists() {
                return Err(format!("{} already exists", sk.display()).into());
            }
            std::fs::write(&sk, k.secret_base64() + "\n")?;
            std::fs::write(&pk, k.signer() + "\n")?;
            eprintln!(
                "secret key: {} (keep it private)\npublic key: {}",
                sk.display(),
                pk.display()
            );
            println!("{}", k.signer());
        }
        Cmd::Sign { src, dst, key } => {
            let k = key
                .map(|p| -> Res<spdf::KeyPair> {
                    Ok(spdf::KeyPair::from_secret_text(&std::fs::read_to_string(
                        p,
                    )?)?)
                })
                .transpose()?;
            let r = spdf::integrity::seal(&src, &dst, k.as_ref())?;
            print_json(&serde_json::to_value(&r)?);
        }
        Cmd::Verify { file, signer } => {
            let signer = match signer {
                Some(s) if std::path::Path::new(&s).exists() => {
                    Some(std::fs::read_to_string(&s)?.trim().to_string())
                }
                other => other,
            };
            let doc = open(&file)?;
            let r = doc.verify_integrity(signer.as_deref())?;
            print_json(&serde_json::to_value(&r)?);
            let ok = r.hash_ok && r.signature_ok != Some(false) && r.signer_trusted != Some(false);
            return Ok(if ok {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(1)
            });
        }
        Cmd::Conformance { dir, filter } => {
            let report = spdf::conformance::run_dir(&dir, filter.as_deref())?;
            println!("{}", serde_json::to_string_pretty(&report)?);
            return Ok(if report.failed.is_empty() {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(1)
            });
        }
    }
    Ok(ExitCode::SUCCESS)
}

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("spdf: {e}");
            ExitCode::from(2)
        }
    }
}
