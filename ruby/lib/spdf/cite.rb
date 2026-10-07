# frozen_string_literal: true

module Spdf
  # Short author-date citation "(Names, Year, locator)" (specification §10).
  module Cite
    VOWELS = %w[a e i o u á é í ó ú ü].freeze

    module_function

    def short(metadata, anchor, anchor_end = nil, locale: "es")
      es = locale.to_s.tr("_", "-").split("-").first.to_s.downcase == "es"
      names = Array(metadata["author"]).filter_map { |a| name(a) }.reject(&:empty?)
      who = case names.length
            when 0 then short_title(metadata)
            when 1 then names[0]
            when 2 then "#{names[0]}#{es ? (i_sound?(names[1]) ? " e " : " y ") : " and "}#{names[1]}"
            else "#{names[0]} et al."
            end
      parts = [who, year(metadata, es)]
      loc = anchor && locator(anchor, anchor_end, es)
      parts << loc if loc && !loc.empty?
      "(#{parts.join(", ")})"
    end

    def name(a)
      return nil unless a.is_a?(Hash)
      return a["literal"] if a["literal"].is_a?(String) && !a["literal"].empty?

      if a["family"].is_a?(String) && !a["family"].empty?
        ndp = a["non-dropping-particle"]
        return "#{ndp.is_a?(String) && !ndp.empty? ? "#{ndp} " : ""}#{a["family"]}"
      end
      a["given"].to_s
    end

    def i_sound?(s)
      low = s.downcase
      rest =
        if %w[hi hí].include?(low[0, 2]) then low[2..]
        elsif %w[i í].include?(low[0, 1]) then low[1..]
        else return false
        end
      !(rest && !rest.empty? && VOWELS.include?(rest[0]))
    end

    def short_title(m)
      return m["title-short"] if m["title-short"].is_a?(String) && !m["title-short"].empty?

      m["title"].to_s.split(":", 2).first.to_s.strip
    end

    def year(m, es)
      dp = m["issued"].is_a?(Hash) ? m["issued"]["date-parts"] : nil
      y = dp.is_a?(Array) && dp[0].is_a?(Array) ? dp[0][0] : nil
      y = y.to_i if y.is_a?(String) && y.match?(/\A-?\d+\z/)
      y = y.to_i if y.is_a?(Float)
      return(es ? "s. f." : "n.d.") unless y.is_a?(Integer)
      return y.to_s if y.positive?

      "#{-y}#{es ? " a. C." : " BC"}"
    end

    # CSL label and locator of an anchor (SPEC §19.2), or nil.
    def csl_locator(a, e = nil)
      t = a["type"]
      folio = ->(x) { x["printed"].nil? ? nil : (x["source"] == "inferred" ? "[#{x["printed"]}]" : x["printed"].to_s) }
      if t == "page" || (%w[section web].include?(t) && !a["printed"].nil?)
        f = folio.call(a)
        return nil if f.nil?

        label = t == "page" ? { "leaf" => "folio", "column" => "column" }.fetch(a.fetch("foliation", "page"), "page") : "page"
        return [label, "#{f}-#{folio.call(e)}"] if e && e["type"] == t && !e["printed"].nil? && e["printed"] != a["printed"]

        return [label, f]
      end
      case t
      when "section", "web"
        return ["paragraph", a["paragraph"].to_s] unless a["paragraph"].nil?
        return ["section", a["path"].last.to_s] if a["path"].is_a?(Array) && !a["path"].empty?

        nil
      when "time"
        s = hms(a["t0"])
        s += "-#{hms(e["t1"])}" if e && e["type"] == "time"
        ["timestamp", s]
      when "verse"
        from = a["line_from"]
        to = a["line_to"]
        ["verse", to.nil? || to == from ? from.to_s : "#{from}-#{to}"]
      when "canonical" then ["section", a["ref"].to_s]
      when "sheet"
        from = a["row_from"]
        to = a["row_to"]
        ["line", from == to ? from.to_s : "#{from}-#{to}"]
      end
    end

    def hms(t)
      s = t.to_f.floor
      h = s / 3600
      m = (s % 3600) / 60
      x = s % 60
      h.positive? ? Kernel.format("%d:%02d:%02d", h, m, x) : Kernel.format("%d:%02d", m, x)
    end

    def label(a)
      p = a["printed"]
      return nil if p.nil?

      a["source"] == "inferred" ? "[#{p}]" : p.to_s
    end

    def page_locator(a, e, es, one, many)
      la = label(a)
      return(es ? "s. p." : "n. pag.") if la.nil?

      if e && e["type"] == a["type"]
        lb = label(e)
        return "#{many} #{la}-#{lb}" if lb && e["printed"] != a["printed"]
      end
      "#{one} #{la}"
    end

    def locator(a, e, es)
      case a["type"]
      when "page"
        one, many = { "leaf" => ["fol.", "fols."], "column" => ["col.", "cols."] }.fetch(a.fetch("foliation", "page"), ["p.", "pp."])
        page_locator(a, e, es, one, many)
      when "time"
        s = hms(a["t0"])
        s += "-#{hms(e["t1"])}" if e && e["type"] == "time"
        s
      when "section", "web"
        return page_locator(a, e, es, "p.", "pp.") unless a["printed"].nil?

        parts = []
        parts << "§ #{a["path"].last}" if a["path"].is_a?(Array) && !a["path"].empty?
        parts << "#{es ? "párr." : "para."} #{a["paragraph"]}" unless a["paragraph"].nil?
        parts.empty? ? nil : parts.join(", ")
      when "slide" then "#{es ? "diap." : "slide"} #{a["n"]}"
      when "sheet"
        from = a["row_from"]
        to = a["row_to"]
        if from == to
          "#{a["sheet"]}, #{es ? "fila" : "row"} #{from}"
        else
          "#{a["sheet"]}, #{es ? "filas" : "rows"} #{from}-#{to}"
        end
      when "verse"
        from = a["line_from"]
        to = a["line_to"]
        to.nil? || to == from ? "v. #{from}" : "vv. #{from}-#{to}"
      when "canonical" then a["ref"]&.to_s
      end
    end
  end
end
