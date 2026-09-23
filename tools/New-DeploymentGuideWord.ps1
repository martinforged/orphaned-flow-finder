param(
    [Parameter(Mandatory = $true)]
    [string]$MarkdownPath,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$script:Body = New-Object System.Text.StringBuilder
$script:Hyperlinks = [ordered]@{}
$script:NextHyperlinkId = 10

function Escape-Xml {
    param([AllowEmptyString()][string]$Text)
    if ($null -eq $Text) { return "" }
    return [System.Security.SecurityElement]::Escape($Text)
}

function Get-HyperlinkId {
    param([string]$Url)
    if (-not $script:Hyperlinks.Contains($Url)) {
        $script:Hyperlinks[$Url] = "rId$($script:NextHyperlinkId)"
        $script:NextHyperlinkId++
    }
    return $script:Hyperlinks[$Url]
}

function New-RunXml {
    param(
        [AllowEmptyString()][string]$Text,
        [switch]$Bold,
        [switch]$Italic,
        [switch]$Code,
        [string]$Color = ""
    )

    $properties = New-Object System.Text.StringBuilder
    if ($Bold) { [void]$properties.Append("<w:b/>") }
    if ($Italic) { [void]$properties.Append("<w:i/>") }
    if ($Code) {
        [void]$properties.Append('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>')
        [void]$properties.Append('<w:sz w:val="18"/><w:szCs w:val="18"/>')
        [void]$properties.Append('<w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/>')
    }
    if ($Color) {
        [void]$properties.Append("<w:color w:val=`"$Color`"/>")
    }

    $escaped = Escape-Xml $Text
    return "<w:r><w:rPr>$properties</w:rPr><w:t xml:space=`"preserve`">$escaped</w:t></w:r>"
}

function Convert-InlineToXml {
    param([AllowEmptyString()][string]$Text)

    $pattern = '(\*\*.+?\*\*|`.+?`|\[[^\]]+\]\(https?://[^)]+\))'
    $matches = [regex]::Matches($Text, $pattern)
    if ($matches.Count -eq 0) {
        return New-RunXml -Text $Text
    }

    $result = New-Object System.Text.StringBuilder
    $position = 0

    foreach ($match in $matches) {
        if ($match.Index -gt $position) {
            [void]$result.Append((New-RunXml -Text $Text.Substring($position, $match.Index - $position)))
        }

        $token = $match.Value
        if ($token.StartsWith("**")) {
            [void]$result.Append((New-RunXml -Text $token.Substring(2, $token.Length - 4) -Bold))
        }
        elseif ($token.StartsWith('`')) {
            [void]$result.Append((New-RunXml -Text $token.Substring(1, $token.Length - 2) -Code))
        }
        elseif ($token.StartsWith("[")) {
            $linkMatch = [regex]::Match($token, '^\[([^\]]+)\]\((https?://[^)]+)\)$')
            if ($linkMatch.Success) {
                $textValue = Escape-Xml $linkMatch.Groups[1].Value
                $url = $linkMatch.Groups[2].Value
                $relationshipId = Get-HyperlinkId -Url $url
                [void]$result.Append(
                    ('<w:hyperlink r:id="{0}"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t xml:space="preserve">{1}</w:t></w:r></w:hyperlink>' -f $relationshipId, $textValue)
                )
            }
        }

        $position = $match.Index + $match.Length
    }

    if ($position -lt $Text.Length) {
        [void]$result.Append((New-RunXml -Text $Text.Substring($position)))
    }

    return $result.ToString()
}

function Add-Paragraph {
    param(
        [AllowEmptyString()][string]$Text,
        [string]$Style = "Normal",
        [int]$Before = 0,
        [int]$After = 120,
        [int]$Left = 0,
        [int]$Hanging = 0,
        [string]$Prefix = ""
    )

    $indent = ""
    if ($Left -gt 0 -or $Hanging -gt 0) {
        $indent = "<w:ind w:left=`"$Left`" w:hanging=`"$Hanging`"/>"
    }

    $runs = New-Object System.Text.StringBuilder
    if ($Prefix) {
        [void]$runs.Append((New-RunXml -Text $Prefix -Bold))
    }
    [void]$runs.Append((Convert-InlineToXml -Text $Text))

    [void]$script:Body.Append(
        "<w:p><w:pPr><w:pStyle w:val=`"$Style`"/><w:spacing w:before=`"$Before`" w:after=`"$After`" w:line=`"276`" w:lineRule=`"auto`"/>$indent</w:pPr>$runs</w:p>"
    )
}

function Add-CodeParagraph {
    param([AllowEmptyString()][string]$Text)
    $escaped = Escape-Xml $Text
    [void]$script:Body.Append(
        "<w:p><w:pPr><w:pStyle w:val=`"CodeBlock`"/><w:spacing w:before=`"0`" w:after=`"0`" w:line=`"240`" w:lineRule=`"auto`"/><w:shd w:val=`"clear`" w:color=`"auto`" w:fill=`"F3F4F6`"/><w:ind w:left=`"240`" w:right=`"240`"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii=`"Consolas`" w:hAnsi=`"Consolas`"/><w:sz w:val=`"18`"/><w:szCs w:val=`"18`"/></w:rPr><w:t xml:space=`"preserve`">$escaped</w:t></w:r></w:p>"
    )
}

function Add-PageBreak {
    [void]$script:Body.Append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
}

function Add-Table {
    param([object[]]$Rows)

    if ($Rows.Count -eq 0) { return }

    $columnCount = $Rows[0].Count
    if ($columnCount -le 0) { return }

    $width = [math]::Floor(9000 / $columnCount)
    $table = New-Object System.Text.StringBuilder
    [void]$table.Append(
        '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="autofit"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>'
    )

    for ($rowIndex = 0; $rowIndex -lt $Rows.Count; $rowIndex++) {
        [void]$table.Append("<w:tr>")
        foreach ($cell in $Rows[$rowIndex]) {
            $shading = if ($rowIndex -eq 0) {
                '<w:shd w:val="clear" w:color="auto" w:fill="D9EAF7"/>'
            } else {
                ""
            }
            $cellRuns = if ($rowIndex -eq 0) {
                New-RunXml -Text ([string]$cell) -Bold
            } else {
                Convert-InlineToXml -Text ([string]$cell)
            }
            [void]$table.Append(
                "<w:tc><w:tcPr><w:tcW w:w=`"$width`" w:type=`"dxa`"/>$shading<w:vAlign w:val=`"center`"/></w:tcPr><w:p><w:pPr><w:pStyle w:val=`"TableText`"/><w:spacing w:after=`"40`"/></w:pPr>$cellRuns</w:p></w:tc>"
            )
        }
        [void]$table.Append("</w:tr>")
    }

    [void]$table.Append("</w:tbl>")
    [void]$script:Body.Append($table.ToString())
    Add-Paragraph -Text "" -After 80
}

function Parse-TableRow {
    param([string]$Line)
    $trimmed = $Line.Trim().Trim("|")
    return @($trimmed.Split("|") | ForEach-Object { $_.Trim() })
}

function Test-TableSeparator {
    param([string]$Line)
    $cells = Parse-TableRow -Line $Line
    if ($cells.Count -eq 0) { return $false }
    foreach ($cell in $cells) {
        if ($cell -notmatch '^:?-{3,}:?$') { return $false }
    }
    return $true
}

function Add-TableOfContents {
    Add-Paragraph -Text "Table of Contents" -Style "Heading1" -Before 0 -After 120
    [void]$script:Body.Append(
        '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \o "1-3" \h \z \u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Open in Microsoft Word and update this field to refresh the table of contents.</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
    )
    Add-PageBreak
}

function Add-ZipEntry {
    param(
        [System.IO.Compression.ZipArchive]$Archive,
        [string]$Name,
        [string]$Content
    )

    $entry = $Archive.CreateEntry($Name, [System.IO.Compression.CompressionLevel]::Optimal)
    $stream = $entry.Open()
    try {
        $encoding = New-Object System.Text.UTF8Encoding($false)
        $writer = New-Object System.IO.StreamWriter($stream, $encoding)
        try {
            $writer.Write($Content)
        }
        finally {
            $writer.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

$markdownLines = Get-Content -LiteralPath $MarkdownPath -Encoding UTF8

# Title page
Add-Paragraph -Text "Orphaned Flow Finder" -Style "Title" -Before 1200 -After 120
Add-Paragraph -Text "Deployment and Tenant Onboarding Guide" -Style "Subtitle" -Before 0 -After 500
Add-Paragraph -Text "Version 1.0" -Style "Centered" -Before 0 -After 80
Add-Paragraph -Text "GCC-to-GCC validated deployment path" -Style "Centered" -Before 0 -After 80
Add-Paragraph -Text "Prepared September 2026" -Style "Centered" -Before 0 -After 500
Add-Paragraph -Text "SHAREABLE DEPLOYMENT GUIDE" -Style "Notice" -Before 0 -After 80
Add-Paragraph -Text "This document contains no tenant-specific identifiers, user names, email addresses, source-environment connection IDs, or other personally identifiable information." -Style "Notice" -Before 0 -After 120
Add-PageBreak
Add-TableOfContents

$paragraphBuffer = New-Object System.Collections.Generic.List[string]
$inCodeBlock = $false
$firstTitleSkipped = $false

function Flush-ParagraphBuffer {
    if ($paragraphBuffer.Count -gt 0) {
        Add-Paragraph -Text (($paragraphBuffer -join " ").Trim())
        $paragraphBuffer.Clear()
    }
}

for ($index = 0; $index -lt $markdownLines.Count; $index++) {
    $line = $markdownLines[$index]

    if ($line.Trim().StartsWith('```')) {
        Flush-ParagraphBuffer
        if ($inCodeBlock) {
            Add-Paragraph -Text "" -After 100
            $inCodeBlock = $false
        }
        else {
            Add-Paragraph -Text "" -After 20
            $inCodeBlock = $true
        }
        continue
    }

    if ($inCodeBlock) {
        Add-CodeParagraph -Text $line
        continue
    }

    if ($line -match '^\|') {
        Flush-ParagraphBuffer
        $tableLines = New-Object System.Collections.Generic.List[string]
        while ($index -lt $markdownLines.Count -and $markdownLines[$index] -match '^\|') {
            $tableLines.Add($markdownLines[$index])
            $index++
        }
        $index--

        $rows = New-Object System.Collections.Generic.List[object]
        foreach ($tableLine in $tableLines) {
            if (-not (Test-TableSeparator -Line $tableLine)) {
                $rows.Add((Parse-TableRow -Line $tableLine))
            }
        }
        Add-Table -Rows $rows.ToArray()
        continue
    }

    if ([string]::IsNullOrWhiteSpace($line)) {
        Flush-ParagraphBuffer
        continue
    }

    if ($line -match '^#\s+(.+)$') {
        Flush-ParagraphBuffer
        if (-not $firstTitleSkipped) {
            $firstTitleSkipped = $true
        }
        else {
            Add-Paragraph -Text $Matches[1] -Style "Heading1" -Before 280 -After 120
        }
        continue
    }

    if ($line -match '^##\s+(.+)$') {
        Flush-ParagraphBuffer
        Add-Paragraph -Text $Matches[1] -Style "Heading1" -Before 280 -After 120
        continue
    }

    if ($line -match '^###\s+(.+)$') {
        Flush-ParagraphBuffer
        Add-Paragraph -Text $Matches[1] -Style "Heading2" -Before 220 -After 100
        continue
    }

    if ($line -match '^####\s+(.+)$') {
        Flush-ParagraphBuffer
        Add-Paragraph -Text $Matches[1] -Style "Heading3" -Before 180 -After 80
        continue
    }

    if ($line -match '^-\s+\[\s\]\s+(.+)$') {
        Flush-ParagraphBuffer
        Add-Paragraph -Text $Matches[1] -Left 540 -Hanging 360 -Prefix "[ ] "
        continue
    }

    if ($line -match '^-\s+(.+)$') {
        Flush-ParagraphBuffer
        Add-Paragraph -Text $Matches[1] -Left 540 -Hanging 360 -Prefix "• "
        continue
    }

    if ($line -match '^(\d+)\.\s+(.+)$') {
        Flush-ParagraphBuffer
        Add-Paragraph -Text $Matches[2] -Left 540 -Hanging 360 -Prefix "$($Matches[1]). "
        continue
    }

    $paragraphBuffer.Add($line.Trim())
}

Flush-ParagraphBuffer

$hyperlinkRelationships = New-Object System.Text.StringBuilder
foreach ($url in $script:Hyperlinks.Keys) {
    $relationshipId = $script:Hyperlinks[$url]
    $escapedUrl = Escape-Xml $url
    [void]$hyperlinkRelationships.Append(
        "<Relationship Id=`"$relationshipId`" Type=`"http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink`" Target=`"$escapedUrl`" TargetMode=`"External`"/>"
    )
}

$contentTypes = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
"@

$packageRelationships = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
"@

$documentRelationships = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
  $hyperlinkRelationships
</Relationships>
"@

$styles = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:color w:val="24324A"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/>
    <w:pPr><w:jc w:val="center"/><w:keepNext/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Aptos Display" w:hAnsi="Aptos Display"/><w:b/><w:color w:val="12395B"/><w:sz w:val="52"/><w:szCs w:val="52"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle">
    <w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/>
    <w:pPr><w:jc w:val="center"/><w:keepNext/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Aptos Display" w:hAnsi="Aptos Display"/><w:color w:val="087B72"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Centered">
    <w:name w:val="Centered"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:color w:val="5D6A80"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Notice">
    <w:name w:val="Notice"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:shd w:val="clear" w:color="auto" w:fill="EAF7F5"/><w:ind w:left="720" w:right="720"/><w:spacing w:before="60" w:after="60"/></w:pPr><w:rPr><w:b/><w:color w:val="125D52"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:uiPriority w:val="9"/>
    <w:pPr><w:keepNext/><w:keepLines/><w:outlineLvl w:val="0"/><w:spacing w:before="280" w:after="100"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Aptos Display" w:hAnsi="Aptos Display"/><w:b/><w:color w:val="12395B"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:uiPriority w:val="9"/>
    <w:pPr><w:keepNext/><w:keepLines/><w:outlineLvl w:val="1"/><w:spacing w:before="220" w:after="80"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Aptos Display" w:hAnsi="Aptos Display"/><w:b/><w:color w:val="087B72"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:uiPriority w:val="9"/>
    <w:pPr><w:keepNext/><w:keepLines/><w:outlineLvl w:val="2"/><w:spacing w:before="180" w:after="60"/></w:pPr>
    <w:rPr><w:b/><w:color w:val="334A66"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="CodeBlock">
    <w:name w:val="Code Block"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="25344F"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="TableText">
    <w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>
  </w:style>
  <w:style w:type="character" w:styleId="Hyperlink">
    <w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr>
  </w:style>
  <w:style w:type="table" w:styleId="TableGrid">
    <w:name w:val="Table Grid"/><w:uiPriority w:val="59"/><w:qFormat/>
    <w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="B8C6D6"/><w:left w:val="single" w:sz="4" w:color="B8C6D6"/><w:bottom w:val="single" w:sz="4" w:color="B8C6D6"/><w:right w:val="single" w:sz="4" w:color="B8C6D6"/><w:insideH w:val="single" w:sz="4" w:color="D5DDE6"/><w:insideV w:val="single" w:sz="4" w:color="D5DDE6"/></w:tblBorders><w:tblCellMar><w:top w:w="90" w:type="dxa"/><w:left w:w="110" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tblCellMar></w:tblPr>
  </w:style>
</w:styles>
"@

$settings = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:zoom w:percent="100"/>
  <w:updateFields w:val="true"/>
  <w:defaultTabStop w:val="720"/>
  <w:compat/>
</w:settings>
"@

$header = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:pPr><w:jc w:val="right"/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="20BCA5"/></w:pBdr></w:pPr><w:r><w:rPr><w:b/><w:color w:val="12395B"/><w:sz w:val="18"/></w:rPr><w:t>ORPHANED FLOW FINDER - DEPLOYMENT GUIDE</w:t></w:r></w:p>
</w:hdr>
"@

$footer = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:space="1" w:color="D5DDE6"/></w:pBdr><w:tabs><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr><w:r><w:rPr><w:color w:val="69758B"/><w:sz w:val="16"/></w:rPr><w:t>Shareable - No tenant-specific PII</w:t></w:r><w:r><w:tab/></w:r><w:r><w:rPr><w:color w:val="69758B"/><w:sz w:val="16"/></w:rPr><w:t>Page </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
</w:ftr>
"@

$document = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    $($script:Body.ToString())
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rId3"/>
      <w:footerReference w:type="default" r:id="rId4"/>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="540" w:footer="540" w:gutter="0"/>
      <w:cols w:space="720"/>
    </w:sectPr>
  </w:body>
</w:document>
"@

$timestamp = (Get-Date).ToUniversalTime().ToString("s") + "Z"
$coreProperties = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Orphaned Flow Finder Deployment and Tenant Onboarding Guide</dc:title>
  <dc:subject>GCC tenant deployment and Power Platform solution onboarding</dc:subject>
  <dc:creator>Orphaned Flow Finder Deployment Team</dc:creator>
  <cp:keywords>Power Platform; Power Apps; Power Automate; Code App; GCC; Deployment</cp:keywords>
  <dc:description>Shareable deployment guide containing no tenant-specific identifiers or personal information.</dc:description>
  <cp:lastModifiedBy>Orphaned Flow Finder Deployment Team</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">$timestamp</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">$timestamp</dcterms:modified>
</cp:coreProperties>
"@

$appProperties = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Office Word</Application>
  <AppVersion>16.0000</AppVersion>
  <Company>Power Platform</Company>
  <Manager></Manager>
</Properties>
"@

$outputDirectory = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $outputDirectory)) {
    [void](New-Item -ItemType Directory -Path $outputDirectory)
}

if (Test-Path -LiteralPath $OutputPath) {
    Remove-Item -LiteralPath $OutputPath -Force
}

$archive = [System.IO.Compression.ZipFile]::Open(
    $OutputPath,
    [System.IO.Compression.ZipArchiveMode]::Create
)

try {
    Add-ZipEntry -Archive $archive -Name "[Content_Types].xml" -Content $contentTypes
    Add-ZipEntry -Archive $archive -Name "_rels/.rels" -Content $packageRelationships
    Add-ZipEntry -Archive $archive -Name "word/document.xml" -Content $document
    Add-ZipEntry -Archive $archive -Name "word/styles.xml" -Content $styles
    Add-ZipEntry -Archive $archive -Name "word/settings.xml" -Content $settings
    Add-ZipEntry -Archive $archive -Name "word/header1.xml" -Content $header
    Add-ZipEntry -Archive $archive -Name "word/footer1.xml" -Content $footer
    Add-ZipEntry -Archive $archive -Name "word/_rels/document.xml.rels" -Content $documentRelationships
    Add-ZipEntry -Archive $archive -Name "docProps/core.xml" -Content $coreProperties
    Add-ZipEntry -Archive $archive -Name "docProps/app.xml" -Content $appProperties
}
finally {
    $archive.Dispose()
}

Write-Output "Created $OutputPath"
