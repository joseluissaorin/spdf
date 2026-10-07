# frozen_string_literal: true

require "cgi/escape"

module Spdf
  # Exports to library formats (SPEC §19.4): ALTO 4, a minimal TEI P5 and a IIIF
  # Presentation 3 manifest. SPDF stores text per unit, not word boxes, so nothing here
  # carries invented coordinates.
  module Interop
    ALTO_NS = "http://www.loc.gov/standards/alto/ns-v4#"
    TEI_NS = "http://www.tei-c.org/ns/1.0"
    IIIF_CONTEXT = "http://iiif.io/api/presentation/3/context.json"
    DEFAULT_SIZE = [1000, 1414].freeze

    module_function

    def x(s) = CGI.escapeHTML(s.to_s)

    def clean(line)
      line.to_s.sub(/\A\s{0,3}(#{"#"}{1,6}\s+|>\s?|[-*+]\s+(?=\S))/, "").gsub(/(\*\*|__|`)/, "")
    end

    def paragraphs(text) = text.to_s.split(/\n\s*\n/).map(&:strip).reject(&:empty?)

    # The folio of a page anchor as TEI pb/@n and IIIF labels write it ([iv] if inferred).
    def folio(a)
      return nil if a["printed"].nil?

      a["source"] == "inferred" ? "[#{a["printed"]}]" : a["printed"].to_s
    end

    def doc_title(doc) = (doc.title || doc.document["id"]).to_s

    # ALTO 4 XML: one Page per page unit.
    def alto(doc)
      pages = doc.units.select { |u| u["anchor"].is_a?(Hash) && u["anchor"]["type"] == "page" }
      raise Error.new("E000", "ALTO export needs page units; this document has none (try TEI or IIIF)") if pages.empty?

      out = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<alto xmlns=\"#{ALTO_NS}\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" " \
        "xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" " \
        "xsi:schemaLocation=\"#{ALTO_NS} http://www.loc.gov/standards/alto/v4/alto-4-4.xsd\">",
        "<Description>", "<MeasurementUnit>pixel</MeasurementUnit>", "<sourceImageInformation>",
        "<fileName>#{x(doc_title(doc))}</fileName>", "<fileIdentifier>#{x(doc.docref)}</fileIdentifier>",
        "</sourceImageInformation>", '<Processing ID="PROC_SPDF">',
        "<processingStepDescription>Export from SPDF</processingStepDescription>",
        "<processingSoftware><softwareName>spdf-format-ruby</softwareName><softwareVersion>#{VERSION}</softwareVersion></processingSoftware>",
        "</Processing>", "</Description>", '<Tags><StructureTag ID="TAG_NOTE" LABEL="footnote"/></Tags>', "<Layout>"
      ]
      pages.each do |u|
        a = u["anchor"]
        physical = (a["physical"] || u["ord"]).to_i
        pid = "P#{physical}"
        attrs = "ID=\"#{pid}\" PHYSICAL_IMG_NR=\"#{physical}\""
        attrs += " PRINTED_IMG_NR=\"#{x(a["printed"])}\"" if !a["printed"].nil? && a["source"] != "inferred"
        attrs += format(' PC="%s"', format("%.4f", u["confidence"].to_f.clamp(0.0, 1.0)).sub(/0+\z/, "").sub(/\.\z/, "")) unless u["confidence"].nil?
        out << "<Page #{attrs}>"
        if u["header"] && u["header"] != ""
          out << "<TopMargin ID=\"#{pid}_TM\">"
          out.concat(alto_blocks("#{pid}_TM_B", u["header"]))
          out << "</TopMargin>"
        end
        if u["footer"] && u["footer"] != ""
          out << "<BottomMargin ID=\"#{pid}_BM\">"
          out.concat(alto_blocks("#{pid}_BM_B", u["footer"]))
          out << "</BottomMargin>"
        end
        out << "<PrintSpace ID=\"#{pid}_PS\">"
        out.concat(alto_blocks("#{pid}_B", u["text"]))
        out.concat(alto_blocks("#{pid}_N", u["notes"].join("\n\n"), ' TAGREFS="TAG_NOTE"')) if u["notes"].is_a?(Array) && !u["notes"].empty?
        out << "</PrintSpace>" << "</Page>"
      end
      out << "</Layout>" << "</alto>"
      "#{out.join("\n")}\n"
    end

    def alto_blocks(id, text, extra = "")
      out = []
      paragraphs(text).each_with_index do |para, bi|
        bid = "#{id}_#{bi + 1}"
        out << "<TextBlock ID=\"#{bid}\"#{extra}>"
        li = 0
        para.split("\n").each do |line|
          words = clean(line).split
          next if words.empty?

          li += 1
          parts = words.each_with_index.map do |w, wi|
            "#{wi.positive? ? "<SP/>" : ""}<String ID=\"#{bid}_L#{li}_W#{wi + 1}\" CONTENT=\"#{x(w)}\"/>"
          end
          out << "<TextLine ID=\"#{bid}_L#{li}\">#{parts.join}</TextLine>"
        end
        out << "</TextBlock>"
      end
      out
    end

    def person(p)
      return "" unless p.is_a?(Hash)
      return p["literal"].to_s if p["literal"] && p["literal"] != ""

      family = [p["non-dropping-particle"], p["family"]].compact.join(" ").strip
      given = p["given"].to_s
      !family.empty? && !given.empty? ? "#{family}, #{given}" : (family.empty? ? given : family)
    end

    # A minimal TEI P5 document: header from the metadata, pb/p/lg/u/note in the body.
    def tei(doc)
      d = doc.document
      m = doc.metadata
      lang = d["language"]
      out = ['<?xml version="1.0" encoding="UTF-8"?>', "<TEI xmlns=\"#{TEI_NS}\"#{lang ? " xml:lang=\"#{x(lang)}\"" : ""}>",
             "<teiHeader>", "<fileDesc>", "<titleStmt>", "<title>#{x(doc_title(doc))}</title>"]
      { "author" => "author", "editor" => "editor" }.each do |csl, tag|
        Array(m[csl]).each do |p|
          name = person(p)
          out << "<#{tag}>#{x(name)}</#{tag}>" unless name.empty?
        end
      end
      out << "</titleStmt>" << "<publicationStmt>" << "<distributor>Exported from SPDF with spdf-format-ruby</distributor>"
      out << "<idno type=\"SPDF\">spdf:#{x(doc.docref)}</idno>"
      rights = d["rights"].is_a?(Hash) ? d["rights"] : {}
      unless rights.empty?
        lic = rights["license"]
        target = lic.is_a?(String) && lic.start_with?("http") ? " target=\"#{x(lic)}\"" : ""
        text = [lic.is_a?(String) ? lic : nil, rights["holder"], rights["note"]].compact.join(" ").strip
        out << "<availability><licence#{target}>#{x(text)}</licence></availability>"
      end
      out << "</publicationStmt>" << "<sourceDesc>" << "<bibl>" << "<title>#{x(m["title"] || doc_title(doc))}</title>"
      Array(m["author"]).each do |p|
        name = person(p)
        out << "<author>#{x(name)}</author>" unless name.empty?
      end
      [["container-title", 'title level="m"', "title"], %w[publisher-place pubPlace pubPlace], %w[publisher publisher publisher],
       %w[edition edition edition], %w[collection-title series series]].each do |csl, open, close|
        v = m[csl]
        out << "<#{open}>#{x(v)}</#{close}>" if v && !v.is_a?(Enumerable) && v.to_s != ""
      end
      parts = m.dig("issued", "date-parts", 0) if m["issued"].is_a?(Hash) && m["issued"]["date-parts"].is_a?(Array)
      if parts.is_a?(Array) && !parts.empty?
        whenv = parts.each_with_index.map { |v, i| format(i.zero? ? "%04d" : "%02d", v.to_i) }.join("-")
        out << "<date when=\"#{x(whenv)}\">#{x(whenv)}</date>"
      end
      { "DOI" => "DOI", "ISBN" => "ISBN", "URL" => "URI" }.each do |csl, type|
        out << "<idno type=\"#{type}\">#{x(m[csl])}</idno>" if m[csl] && m[csl].to_s != ""
      end
      out << "</bibl>" << "</sourceDesc>" << "</fileDesc>"
      out << "<profileDesc><langUsage><language ident=\"#{x(lang)}\"/></langUsage></profileDesc>" if lang
      out << "</teiHeader>" << "<text>" << "<body>"
      doc.units.each { |u| out.concat(tei_unit(u)) }
      out << "</body>" << "</text>" << "</TEI>"
      "#{out.join("\n")}\n"
    end

    def tei_unit(u)
      a = u["anchor"].is_a?(Hash) ? u["anchor"] : {}
      type = a["type"]
      out = []
      if type == "page"
        attrs = +""
        n = folio(a)
        attrs << " n=\"#{x(n)}\"" if n
        attrs << " facs=\"#{x(u["image"])}\"" if u["image"] && u["image"] != ""
        out << "<pb#{attrs}/>"
      end
      text = u["text"].to_s
      notes = Array(u["notes"]).map { |n| "<note place=\"foot\">#{x(clean(n))}</note>" }
      if type == "verse" && a["line_from"]
        out << "<lg>"
        text.split("\n").reject { |l| l.strip.empty? }.each_with_index do |line, i|
          out << "<l n=\"#{a["line_from"].to_i + i}\">#{x(clean(line).strip)}</l>"
        end
        out << "</lg>"
      elsif type == "time"
        paragraphs(text).each do |para|
          who = a["speaker"]
          if (md = para.match(/\A\*\*([^*]{1,80}):\*\*\s*/))
            who = md[1].strip
            para = para[md[0].length..]
          end
          who_attr = who ? " who=\"##{x(who.to_s.gsub(/[^A-Za-z0-9_.-]+/, "_"))}\"" : ""
          out << "<u#{who_attr}>#{x(clean(para))}</u>"
        end
      elsif %w[section web].include?(type) && a["path"].is_a?(Array) && !a["path"].empty?
        out << "<div>" << "<head>#{x(a["path"].last)}</head>"
        paragraphs(text).each { |para| out << "<p>#{x(clean(para))}</p>" }
        out.concat(notes) << "</div>"
        return out
      else
        paragraphs(text).each { |para| out << "<p>#{x(clean(para))}</p>" }
      end
      out.concat(notes)
    end

    # IIIF Presentation 3 manifest (a Hash ready for JSON); base_url is where it will live.
    def iiif(doc, base_url)
      base = base_url.sub(%r{/+\z}, "")
      d = doc.document
      m = doc.metadata
      lang = d["language"].is_a?(String) && !d["language"].empty? ? d["language"] : "none"
      title = doc_title(doc)
      url = lambda do |ref|
        next nil if ref.nil? || ref == ""
        next "#{base}/blobs/#{AnchorUri.enc(ref[5..])}" if ref.start_with?("blob:")

        ref.match?(%r{\Ahttps?://}) ? ref : nil
      end
      manifest = { "@context" => IIIF_CONTEXT, "id" => "#{base}/manifest.json", "type" => "Manifest", "label" => { lang => [title] } }
      md = { "Author" => d["authors"], "Date" => d["year"], "Publisher" => m["publisher"], "Place" => m["publisher-place"],
             "Language" => d["language"], "SPDF" => "spdf:#{doc.docref}" }
      manifest["metadata"] = md.reject { |_, v| v.nil? || v == "" }.map { |k, v| { "label" => { "en" => [k] }, "value" => { "none" => [v.to_s] } } }
      manifest["summary"] = { lang => [m["abstract"]] } if m["abstract"].is_a?(String)
      units = doc.units
      figures = doc.figures.group_by { |g| g["unit"] }
      canvas_of = {}
      text_anno = lambda do |u, aid, target|
        { "id" => aid, "type" => "Annotation", "motivation" => "supplementing",
          "body" => { "type" => "TextualBody", "value" => u["text"].to_s, "format" => "text/markdown", "language" => lang },
          "target" => target, "seeAlso" => [{ "id" => doc.anchor_uri(u["anchor"]), "type" => "Text", "format" => "text/plain" }] }
      end
      canvases = []
      if %w[audio video].include?(d["kind"])
        cid = "#{base}/canvas/1"
        duration = d["duration"].to_f.positive? ? d["duration"].to_f : [1.0, *units.map { |u| u["t1"].to_f }].max
        canvas = { "id" => cid, "type" => "Canvas", "label" => { lang => [title] }, "duration" => duration, "items" => [] }
        media = url.call(d["source_ref"])
        if media
          canvas["items"] = [{ "id" => "#{cid}/page/1", "type" => "AnnotationPage", "items" => [
            { "id" => "#{cid}/page/1/a1", "type" => "Annotation", "motivation" => "painting",
              "body" => { "id" => media, "type" => d["kind"] == "audio" ? "Sound" : "Video", "format" => d["mime"], "duration" => duration },
              "target" => cid }
          ] }]
        end
        annos = []
        units.each do |u|
          canvas_of[u["id"]] = cid
          next if u["text"].to_s.strip.empty?

          t0 = u["t0"] || u["anchor"]["t0"]
          t1 = u["t1"] || u["anchor"]["t1"] || t0
          target = t0.nil? ? cid : "#{cid}#t=#{Json.number(t0.to_f)},#{Json.number(t1.to_f)}"
          annos << text_anno.call(u, "#{cid}/annotations/#{u["ord"]}", target)
        end
        canvas["annotations"] = [{ "id" => "#{cid}/annotations", "type" => "AnnotationPage", "items" => annos }] unless annos.empty?
        canvases << canvas
      else
        units.each do |u|
          cid = "#{base}/canvas/#{u["ord"]}"
          canvas_of[u["id"]] = cid
          a = u["anchor"].is_a?(Hash) ? u["anchor"] : {}
          w, h = DEFAULT_SIZE
          canvas = { "id" => cid, "type" => "Canvas" }
          label = a["type"] == "page" ? folio(a) : (Cite.locator(a, nil, lang == "es") || u["ord"].to_s)
          canvas["label"] = { "none" => [label] } if label
          canvas["width"] = w
          canvas["height"] = h
          img = url.call(u["image"])
          page = img ? [{ "id" => "#{cid}/page/1/a1", "type" => "Annotation", "motivation" => "painting",
                          "body" => { "id" => img, "type" => "Image", "width" => w, "height" => h }, "target" => cid }] : []
          canvas["items"] = [{ "id" => "#{cid}/page/1", "type" => "AnnotationPage", "items" => page }]
          annos = []
          annos << text_anno.call(u, "#{cid}/annotations/text", cid) unless u["text"].to_s.strip.empty?
          Array(figures[u["id"]]).each_with_index do |g, i|
            r = g["anchor"].is_a?(Hash) ? g["anchor"]["region"] : nil
            target = r.is_a?(Hash) ? "#{cid}#xywh=percent:#{%w[x y w h].map { |k| Json.number(format("%.4f", r[k].to_f * 100).to_f) }.join(",")}" : cid
            desc = [g["caption"], g["description"]].compact.join(" ").strip
            next if desc.empty?

            annos << { "id" => "#{cid}/annotations/figure/#{i + 1}", "type" => "Annotation", "motivation" => "describing",
                       "body" => { "type" => "TextualBody", "value" => desc, "format" => "text/plain", "language" => lang }, "target" => target }
          end
          canvas["annotations"] = [{ "id" => "#{cid}/annotations", "type" => "AnnotationPage", "items" => annos }] unless annos.empty?
          canvases << canvas
        end
      end
      manifest["items"] = canvases
      ranges = iiif_ranges(doc, base, canvas_of, units, lang)
      manifest["structures"] = ranges unless ranges.empty?
      manifest
    end

    def iiif_ranges(doc, base, canvas_of, units, lang)
      sections = doc.sections
      return [] if sections.empty?

      order = units.to_h { |u| [u["id"], u["ord"]] }
      ids = sections.map { |s| s["id"] }
      children = Hash.new { |hh, k| hh[k] = [] }
      sections.each { |s| children[ids.include?(s["parent"]) ? s["parent"] : nil] << s }
      sorter = ->(list) { list.sort_by { |s| [order.fetch(s["unit_from"], 0), s["id"]] } }
      build = lambda do |s|
        items = sorter.call(children[s["id"]]).map { |c| build.call(c) }
        start = order[s["unit_from"]]
        fin = s["unit_to"] ? order.fetch(s["unit_to"], start) : start
        if items.empty? && start
          seen = {}
          units.each do |u|
            cid = canvas_of[u["id"]]
            next unless u["ord"].between?(start, fin || start) && cid && !seen[cid]

            seen[cid] = true
            items << { "id" => cid, "type" => "Canvas" }
          end
        end
        { "id" => "#{base}/range/#{AnchorUri.enc(s["id"])}", "type" => "Range", "label" => { lang => [s["title"].to_s] }, "items" => items }
      end
      sorter.call(children[nil]).map { |s| build.call(s) }
    end
  end
end
