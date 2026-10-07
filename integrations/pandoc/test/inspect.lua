--[[
Structural view of a document after spdf.lua, for `-t native` checks.

Replaces the document with one block per citation (the Cite with its
citations: id, mode, prefix, suffix, and its original content), one block per
anchor link added by spdf-links, and one block per reference in the
metadata (its id and title). The native writer then prints exactly what the
filter produced, and nothing citeproc does afterwards.
]]

function Pandoc(doc)
  local blocks = pandoc.Blocks({})
  doc.blocks:walk({
    Cite = function(c)
      blocks:insert(pandoc.Plain({ c }))
    end,
    Link = function(l)
      if l.target:match("^spdf:") then
        blocks:insert(pandoc.Plain({ pandoc.Str("link:"), pandoc.Space(), l }))
      end
    end,
  })
  for _, r in ipairs(doc.meta.references or {}) do
    blocks:insert(pandoc.Plain({
      pandoc.Str("reference:"),
      pandoc.Space(),
      pandoc.Str(pandoc.utils.stringify(r.id)),
      pandoc.Space(),
      pandoc.Str(pandoc.utils.stringify(r.title or "")),
    }))
  end
  return pandoc.Pandoc(blocks, {})
end
