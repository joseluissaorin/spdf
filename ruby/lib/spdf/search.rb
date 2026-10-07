# frozen_string_literal: true

module Spdf
  # Reference search algorithms (specification §6). Result items:
  # {"fragment_id", "score", "via", "anchor", "anchor_uri"}.
  class Search
    RRF_K = 10
    DEPTH = 50

    attr_reader :route, :match

    def initialize(doc)
      @doc = doc
      @db = doc.container.db
      @route = "fts"
      @match = nil
    end

    def lexical(query, limit: 10) = lexical_raw(query, limit).map { |i| i.except("_n") }

    # {"route", "match", "results"}
    def lexical_detailed(query, limit: 10)
      results = lexical(query, limit: limit)
      { "route" => @route, "match" => @match, "results" => results }
    end

    def vector(query, space:, limit: 10, target: "fragment")
      vector_raw(query, space, limit, target).map { |i| i.except("_n") }
    end

    def hybrid(query, vector, space:, limit: 10)
      depth = [limit, DEPTH].max
      fused = {}
      { "lexical" => lexical_raw(query, depth), "vector" => vector_raw(vector, space, depth, "fragment") }.each do |via, list|
        list.each_with_index do |item, rank|
          f = (fused[item["fragment_id"]] ||= { "item" => item, "score" => 0.0, "via" => [] })
          f["score"] += 1.0 / (RRF_K + rank + 1)
          f["via"] << via
        end
      end
      fused.values.sort_by { |f| [-f["score"], f["item"]["_n"]] }.first(limit).map do |f|
        f["item"].except("_n").merge("score" => f["score"], "via" => f["via"])
      end
    end

    private

    def lexical_raw(query, limit)
      terms, phrases, cjk = Text.query_terms(query)
      @route = "fts"
      @match = nil
      return [] if terms.empty? || limit <= 0

      match = Text.fts_match(terms, phrases)
      legacy = @doc.legacy?
      hits =
        if cjk
          if !legacy && @doc.container.table?("fragments_fts_trigram") && terms.all? { |t| t.length >= 3 }
            @route = "trigram"
            @match = match
            @db.execute("SELECT rowid, bm25(fragments_fts_trigram) AS r FROM fragments_fts_trigram " \
                        "WHERE fragments_fts_trigram MATCH ? ORDER BY r, rowid LIMIT ?", [match, limit])
               .map { |n, r| [n, -r] }
          else
            @route = "substring"
            table = Container.quote(@doc.table_name("fragments") || "fragments")
            text = legacy ? '"texto"' : '"text"'
            sum = (["(instr(#{text}, ?) > 0)"] * terms.length).join(" + ")
            need = phrases ? terms.length : 1
            @db.execute("SELECT n, (#{sum}) AS hits FROM #{table} WHERE (#{sum}) >= ? ORDER BY hits DESC, n LIMIT ?",
                        terms + terms + [need, limit]).map { |n, h| [n, h.to_f] }
          end
        else
          fts = legacy ? "fragmentos_fts" : "fragments_fts"
          @match = match
          @db.execute("SELECT rowid, bm25(#{fts}, 1.0, 0.5, 0.5, 1.0) AS r FROM #{fts} " \
                      "WHERE #{fts} MATCH ? ORDER BY r, rowid LIMIT ?", [match, limit]).map { |n, r| [n, -r] }
        end
      hits.filter_map { |n, score| fragment_item(n, score, ["lexical"]) }
    end

    def vector_raw(query, space, limit, target)
      sp = @doc.space(space) or raise Error.new("E031", "unknown vector space #{space}")
      if query.length != sp["dims"].to_i
        raise Error.new("E030", "the query vector has #{query.length} components; space #{space} has #{sp["dims"]}")
      end

      normalized = sp["normalized"].to_i == 1
      q = query.map(&:to_f)
      scored = @doc.vectors(space, target).map do |id, v|
        [id, normalized ? Vectors.dot(q, v) : Vectors.cosine(q, v)]
      end
      order = tie_order(target)
      scored.sort_by! { |id, s| [-s, target == "figure" ? id : order.fetch(id, Float::INFINITY)] }
      scored.first(limit).filter_map do |id, s|
        if target == "fragment"
          fragment_item(order[id], s, ["vector"]) if order[id]
        else
          other_item(target, id, s)
        end
      end
    end

    def tie_order(target)
      case target
      when "fragment" then @doc.rows("fragments", "", [], only: %w[n id]).to_h { |f| [f["id"], f["n"]] }
      when "unit" then @doc.units.to_h { |u| [u["id"], u["ord"]] }
      else {}
      end
    end

    def fragment_item(n, score, via)
      f = @doc.fragment_by_n(n) or return nil
      anchor = f["anchor"]
      end_anchor = f["anchor_end"].is_a?(Hash) ? f["anchor_end"] : nil
      { "fragment_id" => f["id"], "score" => score, "via" => via, "anchor" => anchor,
        "anchor_uri" => anchor.is_a?(Hash) ? @doc.anchor_uri(anchor, end_anchor) : nil, "_n" => n }
    end

    def other_item(target, id, score)
      anchor = target == "unit" ? @doc.unit(id)&.fetch("anchor", nil) : @doc.figures.find { |g| g["id"] == id }&.fetch("anchor", nil)
      { "target" => target, "id" => id, "score" => score, "via" => ["vector"], "anchor" => anchor,
        "anchor_uri" => anchor.is_a?(Hash) ? @doc.anchor_uri(anchor) : nil }
    end
  end
end
