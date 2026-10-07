# Exports to library formats (SPEC 19.4): ALTO 4, a minimal TEI P5 and a IIIF
# Presentation 3 manifest. No invented coordinates.

xml_escape <- function(s) {
  s <- gsub("&", "&amp;", as.character(s), fixed = TRUE)
  s <- gsub("<", "&lt;", s, fixed = TRUE)
  s <- gsub(">", "&gt;", s, fixed = TRUE)
  s <- gsub("\"", "&quot;", s, fixed = TRUE)
  gsub("'", "&#39;", s, fixed = TRUE)
}

md_clean <- function(line) {
  line <- sub("^\\s{0,3}(#{1,6}\\s+|>\\s?|[-*+]\\s+(?=\\S))", "", line, perl = TRUE)
  gsub("(\\*\\*|__|`)", "", line, perl = TRUE)
}

text_paragraphs <- function(text) {
  p <- trimws(strsplit(as.character(text %||% ""), "\n\\s*\n", perl = TRUE)[[1]])
  p[nzchar(p)]
}

page_folio <- function(a) {
  if (is.null(a$printed)) {
    return(NULL)
  }
  if (identical(a$source, "inferred")) paste0("[", a$printed, "]") else as.character(a$printed)
}

export_title <- function(doc) as.character(spdf_title(doc) %||% doc_document(doc)$id)

alto_blocks <- function(id, text, extra = "") {
  out <- character(0)
  paras <- text_paragraphs(text)
  for (bi in seq_along(paras)) {
    bid <- paste0(id, "_", bi)
    out <- c(out, sprintf("<TextBlock ID=\"%s\"%s>", bid, extra))
    li <- 0
    for (line in strsplit(paras[bi], "\n", fixed = TRUE)[[1]]) {
      words <- strsplit(trimws(md_clean(line)), "\\s+", perl = TRUE)[[1]]
      words <- words[nzchar(words)]
      if (length(words) == 0) next
      li <- li + 1
      parts <- vapply(seq_along(words), function(wi) {
        paste0(if (wi > 1) "<SP/>" else "", sprintf("<String ID=\"%s_L%d_W%d\" CONTENT=\"%s\"/>", bid, li, wi, xml_escape(words[wi])))
      }, character(1))
      out <- c(out, sprintf("<TextLine ID=\"%s_L%d\">%s</TextLine>", bid, li, paste(parts, collapse = "")))
    }
    out <- c(out, "</TextBlock>")
  }
  out
}

#' Export to ALTO, TEI and IIIF
#'
#' The optional exports of the specification (section 19.4). `spdf_alto()` writes ALTO
#' 4 XML with one `Page` per page unit (`PHYSICAL_IMG_NR`, and `PRINTED_IMG_NR` only for
#' printed folios); `spdf_tei()` a minimal TEI P5 document (header from the metadata,
#' `pb`, `p`, `lg`/`l`, `u` and `note` in the body); `spdf_iiif()` a IIIF Presentation 3
#' manifest (one canvas per unit, or one time-based canvas for audio and video, sections
#' as ranges, figures as describing annotations). Nothing carries invented coordinates.
#'
#' @param doc A `spdf_document`.
#' @param base_url Where the IIIF manifest will be published.
#' @return A string (`spdf_alto()`, `spdf_tei()`, `spdf_iiif_json()`) or a list
#'   (`spdf_iiif()`).
#' @examples
#' doc <- spdf_open(system.file("extdata", "quijote.spdf", package = "spdf"))
#' cat(substr(spdf_tei(doc), 1, 400))
#' length(spdf_iiif(doc, "https://example.org/iiif/quijote")$items)
#' spdf_close(doc)
#' @export
spdf_alto <- function(doc) {
  check_open(doc)
  pages <- Filter(function(u) json_is_object(u$anchor) && identical(u$anchor$type, "page"), doc_units(doc))
  if (length(pages) == 0) spdf_abort("E000", "ALTO export needs page units; this document has none (try TEI or IIIF)")
  ns <- "http://www.loc.gov/standards/alto/ns-v4#"
  out <- c(
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    sprintf(paste0("<alto xmlns=\"%s\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" ",
                   "xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" ",
                   "xsi:schemaLocation=\"%s http://www.loc.gov/standards/alto/v4/alto-4-4.xsd\">"), ns, ns),
    "<Description>", "<MeasurementUnit>pixel</MeasurementUnit>", "<sourceImageInformation>",
    paste0("<fileName>", xml_escape(export_title(doc)), "</fileName>"),
    paste0("<fileIdentifier>", xml_escape(spdf_docref(doc)), "</fileIdentifier>"),
    "</sourceImageInformation>", "<Processing ID=\"PROC_SPDF\">",
    "<processingStepDescription>Export from SPDF</processingStepDescription>",
    paste0("<processingSoftware><softwareName>spdf (R)</softwareName><softwareVersion>",
           utils::packageVersion("spdf"), "</softwareVersion></processingSoftware>"),
    "</Processing>", "</Description>", "<Tags><StructureTag ID=\"TAG_NOTE\" LABEL=\"footnote\"/></Tags>", "<Layout>"
  )
  for (u in pages) {
    a <- u$anchor
    physical <- as.integer(a$physical %||% u$ord)
    pid <- paste0("P", physical)
    attrs <- sprintf("ID=\"%s\" PHYSICAL_IMG_NR=\"%d\"", pid, physical)
    if (!is.null(a$printed) && !identical(a$source, "inferred")) attrs <- paste0(attrs, " PRINTED_IMG_NR=\"", xml_escape(a$printed), "\"")
    if (!is.null(u$confidence)) {
      pc <- sub("\\.?0+$", "", sprintf("%.4f", max(0, min(1, as.numeric(u$confidence)))))
      attrs <- paste0(attrs, " PC=\"", pc, "\"")
    }
    out <- c(out, paste0("<Page ", attrs, ">"))
    if (!is.null(u$header) && nzchar(u$header)) out <- c(out, sprintf("<TopMargin ID=\"%s_TM\">", pid), alto_blocks(paste0(pid, "_TM_B"), u$header), "</TopMargin>")
    if (!is.null(u$footer) && nzchar(u$footer)) out <- c(out, sprintf("<BottomMargin ID=\"%s_BM\">", pid), alto_blocks(paste0(pid, "_BM_B"), u$footer), "</BottomMargin>")
    out <- c(out, sprintf("<PrintSpace ID=\"%s_PS\">", pid), alto_blocks(paste0(pid, "_B"), u$text))
    if (is.list(u$notes) && length(u$notes) > 0) {
      out <- c(out, alto_blocks(paste0(pid, "_N"), paste(unlist(u$notes), collapse = "\n\n"), " TAGREFS=\"TAG_NOTE\""))
    }
    out <- c(out, "</PrintSpace>", "</Page>")
  }
  paste0(paste(c(out, "</Layout>", "</alto>"), collapse = "\n"), "\n")
}

tei_person <- function(p) {
  if (!is.list(p)) return("")
  if (!is.null(p$literal) && nzchar(p$literal)) return(as.character(p$literal))
  family <- trimws(paste(c(p[["non-dropping-particle"]], p$family), collapse = " "))
  given <- as.character(p$given %||% "")
  if (nzchar(family) && nzchar(given)) paste0(family, ", ", given) else if (nzchar(family)) family else given
}

tei_unit <- function(u) {
  a <- if (json_is_object(u$anchor)) u$anchor else list()
  type <- a$type %||% ""
  out <- character(0)
  if (type == "page") {
    attrs <- ""
    n <- page_folio(a)
    if (!is.null(n)) attrs <- paste0(attrs, " n=\"", xml_escape(n), "\"")
    if (!is.null(u$image) && nzchar(u$image)) attrs <- paste0(attrs, " facs=\"", xml_escape(u$image), "\"")
    out <- c(out, paste0("<pb", attrs, "/>"))
  }
  text <- as.character(u$text %||% "")
  notes <- vapply(u$notes %||% list(), function(n) paste0("<note place=\"foot\">", xml_escape(md_clean(n)), "</note>"), character(1))
  if (type == "verse" && !is.null(a$line_from)) {
    lines <- strsplit(text, "\n", fixed = TRUE)[[1]]
    lines <- lines[nzchar(trimws(lines))]
    out <- c(out, "<lg>", vapply(seq_along(lines), function(i) {
      sprintf("<l n=\"%d\">%s</l>", as.integer(a$line_from) + i - 1L, xml_escape(trimws(md_clean(lines[i]))))
    }, character(1)), "</lg>")
  } else if (type == "time") {
    for (para in text_paragraphs(text)) {
      who <- a$speaker
      m <- regmatches(para, regexec("^\\*\\*([^*]{1,80}):\\*\\*\\s*", para, perl = TRUE))[[1]]
      if (length(m) > 0) {
        who <- trimws(m[2])
        para <- substring(para, nchar(m[1]) + 1)
      }
      who_attr <- if (!is.null(who)) paste0(" who=\"#", xml_escape(gsub("[^A-Za-z0-9_.-]+", "_", who)), "\"") else ""
      out <- c(out, paste0("<u", who_attr, ">", xml_escape(md_clean(para)), "</u>"))
    }
  } else if (type %in% c("section", "web") && is.list(a$path) && length(a$path) > 0) {
    out <- c(out, "<div>", paste0("<head>", xml_escape(a$path[[length(a$path)]]), "</head>"),
             vapply(text_paragraphs(text), function(p) paste0("<p>", xml_escape(md_clean(p)), "</p>"), character(1), USE.NAMES = FALSE),
             notes, "</div>")
    return(out)
  } else {
    out <- c(out, vapply(text_paragraphs(text), function(p) paste0("<p>", xml_escape(md_clean(p)), "</p>"), character(1), USE.NAMES = FALSE))
  }
  c(out, notes)
}

#' @rdname spdf_alto
#' @export
spdf_tei <- function(doc) {
  check_open(doc)
  d <- doc_document(doc)
  m <- spdf_metadata(doc)
  lang <- d$language
  out <- c("<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
           paste0("<TEI xmlns=\"http://www.tei-c.org/ns/1.0\"", if (!is.null(lang)) paste0(" xml:lang=\"", xml_escape(lang), "\"") else "", ">"),
           "<teiHeader>", "<fileDesc>", "<titleStmt>", paste0("<title>", xml_escape(export_title(doc)), "</title>"))
  for (role in c("author", "editor")) {
    for (p in m[[role]] %||% list()) {
      name <- tei_person(p)
      if (nzchar(name)) out <- c(out, sprintf("<%s>%s</%s>", role, xml_escape(name), role))
    }
  }
  out <- c(out, "</titleStmt>", "<publicationStmt>", "<distributor>Exported from SPDF with spdf (R)</distributor>",
           paste0("<idno type=\"SPDF\">spdf:", xml_escape(spdf_docref(doc)), "</idno>"))
  rights <- if (json_is_object(d$rights)) d$rights else list()
  if (length(rights) > 0) {
    lic <- rights$license
    target <- if (is.character(lic) && startsWith(lic, "http")) paste0(" target=\"", xml_escape(lic), "\"") else ""
    text <- trimws(paste(c(if (is.character(lic)) lic, rights$holder, rights$note), collapse = " "))
    out <- c(out, paste0("<availability><licence", target, ">", xml_escape(text), "</licence></availability>"))
  }
  out <- c(out, "</publicationStmt>", "<sourceDesc>", "<bibl>", paste0("<title>", xml_escape(m$title %||% export_title(doc)), "</title>"))
  for (p in m$author %||% list()) {
    name <- tei_person(p)
    if (nzchar(name)) out <- c(out, paste0("<author>", xml_escape(name), "</author>"))
  }
  tags <- list(c("container-title", "title level=\"m\"", "title"), c("publisher-place", "pubPlace", "pubPlace"),
               c("publisher", "publisher", "publisher"), c("edition", "edition", "edition"), c("collection-title", "series", "series"))
  for (t in tags) {
    v <- m[[t[1]]]
    if (!is.null(v) && !is.list(v) && nzchar(as.character(v))) out <- c(out, sprintf("<%s>%s</%s>", t[2], xml_escape(v), t[3]))
  }
  parts <- tryCatch(m$issued[["date-parts"]][[1]], error = function(e) NULL)
  if (length(parts) > 0) {
    when <- paste(vapply(seq_along(parts), function(i) sprintf(if (i == 1) "%04d" else "%02d", as.integer(parts[[i]])), character(1)), collapse = "-")
    out <- c(out, sprintf("<date when=\"%s\">%s</date>", when, when))
  }
  for (t in list(c("DOI", "DOI"), c("ISBN", "ISBN"), c("URL", "URI"))) {
    v <- m[[t[1]]]
    if (!is.null(v) && nzchar(as.character(v))) out <- c(out, sprintf("<idno type=\"%s\">%s</idno>", t[2], xml_escape(v)))
  }
  out <- c(out, "</bibl>", "</sourceDesc>", "</fileDesc>")
  if (!is.null(lang)) out <- c(out, paste0("<profileDesc><langUsage><language ident=\"", xml_escape(lang), "\"/></langUsage></profileDesc>"))
  out <- c(out, "</teiHeader>", "<text>", "<body>")
  for (u in doc_units(doc)) out <- c(out, tei_unit(u))
  paste0(paste(c(out, "</body>", "</text>", "</TEI>"), collapse = "\n"), "\n")
}

#' @rdname spdf_alto
#' @export
spdf_iiif <- function(doc, base_url) {
  check_open(doc)
  base <- sub("/+$", "", base_url)
  d <- doc_document(doc)
  m <- spdf_metadata(doc)
  lang <- if (is.character(d$language) && nzchar(d$language)) d$language else "none"
  title <- export_title(doc)
  url <- function(ref) {
    if (is.null(ref) || !nzchar(ref)) return(NULL)
    if (startsWith(ref, "blob:")) return(paste0(base, "/blobs/", uri_enc(substring(ref, 6))))
    if (grepl("^https?://", ref)) ref else NULL
  }
  label_of <- function(v) stats::setNames(list(list(v)), lang)
  manifest <- list("@context" = "http://iiif.io/api/presentation/3/context.json", id = paste0(base, "/manifest.json"),
                   type = "Manifest", label = label_of(title))
  md <- list(Author = d$authors, Date = d$year, Publisher = m$publisher, Place = m[["publisher-place"]], Language = d$language,
             SPDF = paste0("spdf:", spdf_docref(doc)))
  md <- md[!vapply(md, function(v) is.null(v) || identical(v, ""), logical(1))]
  manifest$metadata <- unname(lapply(names(md), function(k) list(label = list(en = list(k)), value = list(none = list(as.character(md[[k]]))))))
  if (is.character(m$abstract)) manifest$summary <- label_of(m$abstract)
  units <- doc_units(doc)
  figs <- doc_rows(doc, "figures", "ORDER BY {id}")
  text_anno <- function(u, aid, target) {
    list(id = aid, type = "Annotation", motivation = "supplementing",
         body = list(type = "TextualBody", value = as.character(u$text %||% ""), format = "text/markdown", language = lang),
         target = target, seeAlso = list(list(id = spdf_anchor_uri(spdf_docref(doc), u$anchor), type = "Text", format = "text/plain")))
  }
  canvas_of <- list()
  canvases <- list()
  if (d$kind %in% c("audio", "video")) {
    cid <- paste0(base, "/canvas/1")
    duration <- as.numeric(d$duration %||% 0)
    if (!(duration > 0)) duration <- max(c(1, vapply(units, function(u) as.numeric(u$t1 %||% 0), numeric(1))))
    canvas <- list(id = cid, type = "Canvas", label = label_of(title), duration = duration, items = list())
    media <- url(d$source_ref)
    if (!is.null(media)) {
      canvas$items <- list(list(id = paste0(cid, "/page/1"), type = "AnnotationPage", items = list(list(
        id = paste0(cid, "/page/1/a1"), type = "Annotation", motivation = "painting",
        body = list(id = media, type = if (d$kind == "audio") "Sound" else "Video", format = d$mime, duration = duration), target = cid))))
    }
    annos <- list()
    for (u in units) {
      canvas_of[[u$id]] <- cid
      if (!nzchar(trimws(u$text %||% ""))) next
      t0 <- u$t0 %||% u$anchor$t0
      t1 <- u$t1 %||% u$anchor$t1 %||% t0
      target <- if (is.null(t0)) cid else paste0(cid, "#t=", json_number(as.numeric(t0)), ",", json_number(as.numeric(t1)))
      annos[[length(annos) + 1]] <- text_anno(u, paste0(cid, "/annotations/", u$ord), target)
    }
    if (length(annos) > 0) canvas$annotations <- list(list(id = paste0(cid, "/annotations"), type = "AnnotationPage", items = annos))
    canvases[[1]] <- canvas
  } else {
    for (u in units) {
      cid <- paste0(base, "/canvas/", u$ord)
      canvas_of[[u$id]] <- cid
      a <- if (json_is_object(u$anchor)) u$anchor else list()
      canvas <- list(id = cid, type = "Canvas")
      lab <- if (identical(a$type, "page")) page_folio(a) else (cite_locator(a, NULL, lang == "es") %||% as.character(u$ord))
      if (!is.null(lab)) canvas$label <- list(none = list(lab))
      canvas$width <- 1000L
      canvas$height <- 1414L
      img <- url(u$image)
      page <- if (is.null(img)) list() else list(list(id = paste0(cid, "/page/1/a1"), type = "Annotation", motivation = "painting",
                                                     body = list(id = img, type = "Image", width = 1000L, height = 1414L), target = cid))
      canvas$items <- list(list(id = paste0(cid, "/page/1"), type = "AnnotationPage", items = page))
      annos <- list()
      if (nzchar(trimws(u$text %||% ""))) annos[[1]] <- text_anno(u, paste0(cid, "/annotations/text"), cid)
      mine <- Filter(function(g) identical(g$unit, u$id), figs)
      for (i in seq_along(mine)) {
        g <- mine[[i]]
        r <- if (json_is_object(g$anchor)) g$anchor$region else NULL
        target <- if (json_is_object(r)) {
          paste0(cid, "#xywh=percent:", paste(vapply(c("x", "y", "w", "h"), function(k) {
            json_number(as.numeric(sprintf("%.4f", as.numeric(r[[k]] %||% 0) * 100)))
          }, character(1)), collapse = ","))
        } else cid
        desc <- trimws(paste(c(g$caption, g$description), collapse = " "))
        if (nzchar(desc)) {
          annos[[length(annos) + 1]] <- list(id = paste0(cid, "/annotations/figure/", i), type = "Annotation", motivation = "describing",
                                             body = list(type = "TextualBody", value = desc, format = "text/plain", language = lang), target = target)
        }
      }
      if (length(annos) > 0) canvas$annotations <- list(list(id = paste0(cid, "/annotations"), type = "AnnotationPage", items = annos))
      canvases[[length(canvases) + 1]] <- canvas
    }
  }
  manifest$items <- canvases
  ranges <- iiif_ranges(doc, base, canvas_of, units, lang)
  if (length(ranges) > 0) manifest$structures <- ranges
  manifest
}

#' @rdname spdf_alto
#' @export
spdf_iiif_json <- function(doc, base_url) json_text(spdf_iiif(doc, base_url), pretty = TRUE)

iiif_ranges <- function(doc, base, canvas_of, units, lang) {
  sections <- doc_rows(doc, "sections", "ORDER BY {id}")
  if (length(sections) == 0) return(list())
  ord <- stats::setNames(vapply(units, function(u) as.numeric(u$ord), numeric(1)), vapply(units, function(u) u$id, character(1)))
  ids <- vapply(sections, function(s) s$id, character(1))
  parent_of <- function(s) if (!is.null(s$parent) && s$parent %in% ids) s$parent else ""
  sorted <- function(list_) {
    if (length(list_) == 0) return(list_)
    k1 <- vapply(list_, function(s) if (s$unit_from %in% names(ord)) ord[[s$unit_from]] else 0, numeric(1))
    k2 <- vapply(list_, function(s) s$id, character(1))
    list_[order(k1, k2, method = "radix")]
  }
  build <- function(s) {
    kids <- sorted(Filter(function(c) identical(parent_of(c), s$id), sections))
    items <- lapply(kids, build)
    start <- if (s$unit_from %in% names(ord)) ord[[s$unit_from]] else NULL
    fin <- if (!is.null(s$unit_to) && s$unit_to %in% names(ord)) ord[[s$unit_to]] else start
    if (length(items) == 0 && !is.null(start)) {
      seen <- character(0)
      for (u in units) {
        cid <- canvas_of[[u$id]]
        if (u$ord >= start && u$ord <= fin && !is.null(cid) && !(cid %in% seen)) {
          seen <- c(seen, cid)
          items[[length(items) + 1]] <- list(id = cid, type = "Canvas")
        }
      }
    }
    list(id = paste0(base, "/range/", uri_enc(s$id)), type = "Range", label = stats::setNames(list(list(s$title)), lang), items = items)
  }
  lapply(sorted(Filter(function(s) parent_of(s) == "", sections)), build)
}
