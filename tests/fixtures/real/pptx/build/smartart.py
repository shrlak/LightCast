"""smartart.py <out.pptx>: a deck with one SmartArt (basic process, 3 nodes) saved as PowerPoint does: data, layout, style,
colours and the pre-drawn dsp:drawing part; plus a Office 2016 waterfall chart part (cx) inside mc:AlternateContent."""
import sys, zipfile, io
from pptx import Presentation
from pptx.util import Inches
out = sys.argv[1]
p = Presentation()
s = p.slides.add_slide(p.slide_layouts[5])
s.shapes.title.text = 'SmartArt process'
buf = io.BytesIO(); p.save(buf)
zin = zipfile.ZipFile(io.BytesIO(buf.getvalue()))
files = {n: zin.read(n) for n in zin.namelist()}
DGM = 'http://schemas.openxmlformats.org/drawingml/2006/diagram'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
names = ['계획', 'Build', 'Ship']
pts = ''.join(f'<dgm:pt modelId="{{{i}0000000-0000-0000-0000-000000000000}}"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:p><a:r><a:t>{t}</a:t></a:r></a:p></dgm:t></dgm:pt>' for i, t in enumerate(names, 1))
data = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<dgm:dataModel xmlns:dgm="{DGM}" xmlns:a="{A}" xmlns:r="{R}"><dgm:ptLst><dgm:pt modelId="{{00000000-0000-0000-0000-000000000000}}" type="doc"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:p/></dgm:t></dgm:pt>{pts}</dgm:ptLst><dgm:cxnLst/><dgm:bg/><dgm:whole/><dgm:extLst><a:ext uri="http://schemas.microsoft.com/office/drawing/2008/diagram"><dsp:dataModelExt xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" relId="rId9" minVer="http://schemas.openxmlformats.org/drawingml/2006/diagram"/></a:ext></dgm:extLst></dgm:dataModel>'''
DSP = 'http://schemas.microsoft.com/office/drawing/2008/diagram'
shapes = ''
for i, t in enumerate(names):
    x = 300000 + i * 2900000
    shapes += f'<dsp:sp modelId="{{9{i}000000-0000-0000-0000-000000000000}}"><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr><a:xfrm><a:off x="{x}" y="300000"/><a:ext cx="2300000" cy="1400000"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></dsp:spPr><dsp:style><a:lnRef idx="2"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef><a:fillRef idx="1"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef><a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></dsp:style><dsp:txBody><a:bodyPr spcFirstLastPara="0" vert="horz" wrap="square" lIns="64770" tIns="64770" rIns="64770" bIns="64770" numCol="1" spcCol="1270" anchor="ctr" anchorCtr="0"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="ko-KR" sz="2800"/><a:t>{t}</a:t></a:r></a:p></dsp:txBody><dsp:txXfrm><a:off x="{x}" y="300000"/><a:ext cx="2300000" cy="1400000"/></dsp:txXfrm></dsp:sp>'
    if i < 2:
        shapes += f'<dsp:sp modelId="{{8{i}000000-0000-0000-0000-000000000000}}"><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr><a:xfrm><a:off x="{x + 2380000}" y="800000"/><a:ext cx="440000" cy="400000"/></a:xfrm><a:prstGeom prst="rightArrow"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="A9B8E0"/></a:solidFill></dsp:spPr><dsp:style><a:lnRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef><a:fillRef idx="1"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef><a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></dsp:style></dsp:sp>'
drawing = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<dsp:drawing xmlns:dgm="{DGM}" xmlns:dsp="{DSP}" xmlns:a="{A}"><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/>{shapes}</dsp:spTree></dsp:drawing>'
stub = lambda root, ns: f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<dgm:{root} xmlns:dgm="{DGM}" xmlns:a="{A}" uniqueId="urn:microsoft.com/office/officeart/2005/8/layout/process1"/>'
files['ppt/diagrams/data1.xml'] = data.encode()
files['ppt/diagrams/layout1.xml'] = stub('layoutDef', DGM).encode()
files['ppt/diagrams/quickStyle1.xml'] = stub('styleDef', DGM).encode()
files['ppt/diagrams/colors1.xml'] = stub('colorsDef', DGM).encode()
files['ppt/diagrams/drawing1.xml'] = drawing.encode()
# Office 2016 waterfall chart
CX = 'http://schemas.microsoft.com/office/drawing/2014/chartex'
chartex = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cx:chartSpace xmlns:a="{A}" xmlns:r="{R}" xmlns:cx="{CX}"><cx:chartData><cx:data id="0"><cx:strDim type="cat"><cx:f>Sheet1!$A$2:$A$5</cx:f><cx:lvl ptCount="4"><cx:pt idx="0">Start</cx:pt><cx:pt idx="1">Up</cx:pt><cx:pt idx="2">Down</cx:pt><cx:pt idx="3">End</cx:pt></cx:lvl></cx:strDim><cx:numDim type="val"><cx:f>Sheet1!$B$2:$B$5</cx:f><cx:lvl ptCount="4" formatCode="General"><cx:pt idx="0">100</cx:pt><cx:pt idx="1">30</cx:pt><cx:pt idx="2">-20</cx:pt><cx:pt idx="3">110</cx:pt></cx:lvl></cx:numDim></cx:data></cx:chartData><cx:chart><cx:title><cx:tx><cx:txData><cx:v>Waterfall</cx:v></cx:txData></cx:tx></cx:title><cx:plotArea><cx:plotAreaRegion><cx:series layoutId="waterfall" uniqueId="{{1}}"><cx:tx><cx:txData><cx:v>Cash</cx:v></cx:txData></cx:tx><cx:dataId val="0"/><cx:layoutPr><cx:subtotals><cx:idx val="0"/><cx:idx val="3"/></cx:subtotals></cx:layoutPr></cx:series></cx:plotAreaRegion></cx:plotArea><cx:legend pos="b"/></cx:chart></cx:chartSpace>'''
files['ppt/charts/chartEx1.xml'] = chartex.encode()
ct = files['[Content_Types].xml'].decode()
ct = ct.replace('</Types>', '<Override PartName="/ppt/diagrams/data1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml"/><Override PartName="/ppt/diagrams/layout1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagramLayout+xml"/><Override PartName="/ppt/diagrams/quickStyle1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagramStyle+xml"/><Override PartName="/ppt/diagrams/colors1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagramColors+xml"/><Override PartName="/ppt/diagrams/drawing1.xml" ContentType="application/vnd.ms-office.drawingml.diagramDrawing+xml"/><Override PartName="/ppt/charts/chartEx1.xml" ContentType="application/vnd.ms-office.chartex+xml"/></Types>')
files['[Content_Types].xml'] = ct.encode()
rels = files['ppt/slides/_rels/slide1.xml.rels'].decode()
rels = rels.replace('</Relationships>', '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData" Target="../diagrams/data1.xml"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramLayout" Target="../diagrams/layout1.xml"/><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramQuickStyle" Target="../diagrams/quickStyle1.xml"/><Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramColors" Target="../diagrams/colors1.xml"/><Relationship Id="rId9" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="../diagrams/drawing1.xml"/><Relationship Id="rId10" Type="http://schemas.microsoft.com/office/2014/relationships/chartEx" Target="../charts/chartEx1.xml"/></Relationships>')
files['ppt/slides/_rels/slide1.xml.rels'] = rels.encode()
slide = files['ppt/slides/slide1.xml'].decode()
frame = f'<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="10" name="Diagram 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="457200" y="1700000"/><a:ext cx="8229600" cy="2000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="{DGM}" r:dm="rId5" r:lo="rId6" r:qs="rId7" r:cs="rId8"/></a:graphicData></a:graphic></p:graphicFrame>'
cxframe = f'<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:cx1="http://schemas.microsoft.com/office/drawing/2015/9/8/chartex" Requires="cx1"><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="11" name="Chart 2"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="1500000" y="4000000"/><a:ext cx="6000000" cy="2600000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2014/chartex"><cx:chart xmlns:cx="{CX}" r:id="rId10"/></a:graphicData></a:graphic></p:graphicFrame></mc:Choice><mc:Fallback><p:sp><p:nvSpPr><p:cNvPr id="12" name="Fallback"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1500000" y="4000000"/><a:ext cx="6000000" cy="2600000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>This chart isn\'t available in your version of PowerPoint</a:t></a:r></a:p></p:txBody></p:sp></mc:Fallback></mc:AlternateContent>'
slide = slide.replace('</p:spTree>', frame + cxframe + '</p:spTree>')
files['ppt/slides/slide1.xml'] = slide.encode()
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for n, b in files.items(): z.writestr(n, b)
print('ok')
