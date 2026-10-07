{* Galley view of a SPDF file: title, whole-work citation, search, cited passages. *}
{include file="frontend/components/header.tpl" pageTitleTranslated=$spdfTitle}
<div class="page spdf">
	<h1>{$spdfTitle|escape}</h1>
	<p class="spdf-citation">{$spdfCitation|escape}</p>
	<form method="get">
		<input type="search" name="q" value="{$spdfQuery|escape}" aria-label="{translate key="plugins.generic.spdfViewer.search"}">
		<button type="submit">{translate key="plugins.generic.spdfViewer.search"}</button>
	</form>
	{foreach from=$spdfHits item=hit}
		<blockquote>
			{$hit.text|escape}
			<cite>{$hit.citation|escape}</cite>
			<a href="{$hit.uri|escape}">{$hit.uri|escape}</a>
		</blockquote>
	{/foreach}
	<details>
		<summary>BibTeX</summary>
		<pre>{$spdfBibtex|escape}</pre>
	</details>
</div>
{include file="frontend/components/footer.tpl"}
