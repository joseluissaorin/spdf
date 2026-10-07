# Reference search algorithms (specification section 6).

empty_results <- function() {
  tibble::tibble(fragment_id = character(0), score = numeric(0), via = list(), anchor = list(), anchor_uri = character(0))
}

results_tibble <- function(items) {
  if (length(items) == 0) {
    return(empty_results())
  }
  tibble::tibble(
    fragment_id = vapply(items, function(i) i$fragment_id, character(1)),
    score = vapply(items, function(i) i$score, numeric(1)),
    via = lapply(items, function(i) i$via),
    anchor = lapply(items, function(i) i$anchor),
    anchor_uri = vapply(items, function(i) i$anchor_uri %||% NA_character_, character(1))
  )
}

fragment_index <- function(doc) {
  if (is.null(doc$cache$fragments_by_n)) {
    rows <- doc_rows(doc, "fragments", "ORDER BY {n}", only = c("n", "id", "anchor", "anchor_end"))
    names(rows) <- vapply(rows, function(r) format(r$n, scientific = FALSE), character(1))
    doc$cache$fragments_by_n <- rows
  }
  doc$cache$fragments_by_n
}

fragment_item <- function(doc, n, score, via) {
  f <- fragment_index(doc)[[format(n, scientific = FALSE)]]
  if (is.null(f)) {
    return(NULL)
  }
  end <- if (json_is_object(f$anchor_end)) f$anchor_end else NULL
  list(
    fragment_id = f$id, score = as.numeric(score), via = via, anchor = f$anchor,
    anchor_uri = if (json_is_object(f$anchor)) spdf_anchor_uri(spdf_docref(doc), f$anchor, end) else NULL, n = n
  )
}

lexical_raw <- function(doc, query, limit) {
  plan <- query_terms(query)
  terms <- plan$terms
  trace <- list(route = "fts", match = NULL)
  if (length(terms) == 0 || limit <= 0) {
    return(list(trace = trace, items = list()))
  }
  match <- fts_match(terms, plan$phrases)
  legacy <- doc$legacy
  if (plan$cjk) {
    if (!legacy && "fragments_fts_trigram" %in% doc$tables && all(nchar(terms, type = "chars") >= 3)) {
      trace <- list(route = "trigram", match = match)
      df <- DBI::dbGetQuery(doc$con, paste(
        "SELECT rowid AS n, bm25(fragments_fts_trigram) AS r FROM fragments_fts_trigram",
        "WHERE fragments_fts_trigram MATCH ? ORDER BY r, rowid LIMIT ?"
      ), params = list(match, limit))
      hits <- data.frame(n = df$n, score = -df$r)
    } else {
      trace <- list(route = "substring", match = NULL)
      table <- quote_ident(doc_table_name(doc, "fragments"))
      text <- if (legacy) "\"texto\"" else "\"text\""
      sum <- paste(rep(sprintf("(instr(%s, ?) > 0)", text), length(terms)), collapse = " + ")
      need <- if (plan$phrases) length(terms) else 1
      df <- DBI::dbGetQuery(doc$con, sprintf("SELECT n, (%s) AS hits FROM %s WHERE (%s) >= ? ORDER BY hits DESC, n LIMIT ?", sum, table, sum),
                            params = c(as.list(terms), as.list(terms), list(need, limit)))
      hits <- data.frame(n = df$n, score = as.numeric(df$hits))
    }
  } else {
    fts <- if (legacy) "fragmentos_fts" else "fragments_fts"
    trace <- list(route = "fts", match = match)
    df <- DBI::dbGetQuery(doc$con, sprintf("SELECT rowid AS n, bm25(%s, 1.0, 0.5, 0.5, 1.0) AS r FROM %s WHERE %s MATCH ? ORDER BY r, rowid LIMIT ?", fts, fts, fts),
                          params = list(match, limit))
    hits <- data.frame(n = df$n, score = -df$r)
  }
  items <- lapply(seq_len(nrow(hits)), function(i) fragment_item(doc, hits$n[i], hits$score[i], list("lexical")))
  list(trace = trace, items = Filter(Negate(is.null), items))
}

vector_raw <- function(doc, query, space, limit, target) {
  sp <- doc_space(doc, space)
  if (length(query) != sp$dims) {
    spdf_abort("E030", sprintf("the query vector has %d components; space %s has %d", length(query), space, as.integer(sp$dims)))
  }
  m <- spdf_vectors(doc, space, target)
  if (nrow(m) == 0) {
    return(list())
  }
  q <- as.numeric(unlist(query))
  dots <- as.numeric(m %*% q)
  scores <- if (isTRUE(sp$normalized == 1)) dots else {
    nq <- sqrt(sum(q * q))
    nv <- sqrt(rowSums(m * m))
    ifelse(nq > 0 & nv > 0, dots / (nq * nv), 0)
  }
  ids <- rownames(m)
  tie <- if (target == "fragment") {
    rows <- doc_rows(doc, "fragments", only = c("n", "id"))
    map <- vapply(rows, function(r) as.numeric(r$n), numeric(1))
    names(map) <- vapply(rows, function(r) r$id, character(1))
    unname(map[ids])
  } else if (target == "unit") {
    u <- doc_units(doc)
    map <- vapply(u, function(r) as.numeric(r$ord), numeric(1))
    names(map) <- vapply(u, function(r) r$id, character(1))
    unname(map[ids])
  } else {
    rank(ids, ties.method = "first")
  }
  o <- order(-scores, tie, method = "radix")
  o <- o[seq_len(min(limit, length(o)))]
  items <- lapply(o, function(i) {
    if (target == "fragment") {
      fragment_item(doc, tie[i], scores[i], list("vector"))
    } else {
      list(target = target, fragment_id = ids[i], id = ids[i], score = scores[i], via = list("vector"), anchor = NULL, anchor_uri = NULL)
    }
  })
  Filter(Negate(is.null), items)
}

#' Search a SPDF document
#'
#' The reference algorithms of the specification (section 6). `spdf_search()` is the
#' lexical search: quoted phrases (straight or curly double quotes, guillemets) are required,
#' loose words are alternatives, FTS5 folds case and diacritics, the modernized
#' spelling layer matches automatically, and CJK queries use the trigram index or a
#' substring fallback. `spdf_search_vector()` ranks by dot product (cosine if the
#' space is not normalized); `spdf_search_hybrid()` fuses both lists by reciprocal
#' rank (k = 10).
#'
#' @param doc A `spdf_document`.
#' @param query Query text.
#' @param vector Query vector (same model and dimensions as the space).
#' @param space Vector space id.
#' @param limit Maximum number of results.
#' @param target `"fragment"`, `"unit"` or `"figure"`.
#' @return A tibble with `fragment_id`, `score`, `via`, `anchor` and `anchor_uri`.
#' @examples
#' doc <- spdf_open(system.file("extdata", "quijote.spdf", package = "spdf"))
#' spdf_search(doc, "hidalgo Mancha")
#' spdf_close(doc)
#' @export
spdf_search <- function(doc, query, limit = 10) {
  check_open(doc)
  results_tibble(lexical_raw(doc, query, limit)$items)
}

#' @rdname spdf_search
#' @export
spdf_search_vector <- function(doc, vector, space, limit = 10, target = "fragment") {
  check_open(doc)
  items <- vector_raw(doc, vector, space, limit, target)
  if (target != "fragment") {
    return(tibble::tibble(
      id = vapply(items, function(i) i$id, character(1)),
      score = vapply(items, function(i) i$score, numeric(1))
    ))
  }
  results_tibble(items)
}

#' @rdname spdf_search
#' @export
spdf_search_hybrid <- function(doc, query, vector, space, limit = 10) {
  check_open(doc)
  results_tibble(hybrid_raw(doc, query, vector, space, limit))
}

hybrid_raw <- function(doc, query, vector, space, limit) {
  depth <- max(limit, 50)
  lists <- list(lexical = lexical_raw(doc, query, depth)$items, vector = vector_raw(doc, vector, space, depth, "fragment"))
  fused <- list()
  for (via in names(lists)) {
    lst <- lists[[via]]
    for (rank in seq_along(lst)) {
      it <- lst[[rank]]
      id <- it$fragment_id
      if (is.null(fused[[id]])) fused[[id]] <- list(item = it, score = 0, via = list())
      fused[[id]]$score <- fused[[id]]$score + 1 / (10 + rank)
      fused[[id]]$via <- c(fused[[id]]$via, list(via))
    }
  }
  if (length(fused) == 0) {
    return(list())
  }
  scores <- vapply(fused, function(f) f$score, numeric(1))
  ns <- vapply(fused, function(f) as.numeric(f$item$n), numeric(1))
  o <- order(-scores, ns, method = "radix")[seq_len(min(limit, length(fused)))]
  lapply(o, function(i) {
    it <- fused[[i]]$item
    it$score <- fused[[i]]$score
    it$via <- fused[[i]]$via
    it
  })
}
