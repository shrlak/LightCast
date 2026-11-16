import sys
from pptx import Presentation
from pptx.util import Inches
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn
from lxml import etree
P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
prs = Presentation(); prs.slide_width = Inches(10); prs.slide_height = Inches(7.5)
s = prs.slides.add_slide(prs.slide_layouts[6])
ids = []
for i in range(6):
    sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.5 + i * 1.5), Inches(1), Inches(1), Inches(1)); ids.append(sh.shape_id)

def tgt(spid): return f'<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl>'
def set_vis(spid, v): return f'<p:set><p:cBhvr><p:cTn id="{{n}}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>{tgt(spid)}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="{v}"/></p:to></p:set>'
def effect(spid, preset, cls, sub, node, delay, body):
    return (f'<p:par><p:cTn id="{{n}}" presetID="{preset}" presetClass="{cls}" presetSubtype="{sub}" fill="hold" nodeType="{node}"><p:stCondLst><p:cond delay="{delay}"/></p:stCondLst><p:childTnLst>{body}</p:childTnLst></p:cTn></p:par>')
def fade_body(spid, vis):
    return set_vis(spid, vis) + f'<p:animEffect transition="{"in" if vis=="visible" else "out"}" filter="fade"><p:cBhvr><p:cTn id="{{n}}" dur="500"/>{tgt(spid)}</p:cBhvr></p:animEffect>'
def fly_body(spid):
    return set_vis(spid, 'visible') + f'<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="{{n}}" dur="500" fill="hold"/>{tgt(spid)}<p:attrNameLst><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="1+#ppt_h/2"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="#ppt_y"/></p:val></p:tav></p:tavLst></p:anim>'
def wipe_body(spid):
    return set_vis(spid, 'visible') + f'<p:animEffect transition="in" filter="wipe(left)"><p:cBhvr><p:cTn id="{{n}}" dur="500"/>{tgt(spid)}</p:cBhvr></p:animEffect>'
effs = [
    effect(ids[0], 1, 'entr', 0, 'clickEffect', 0, set_vis(ids[0], 'visible')),
    effect(ids[1], 10, 'entr', 0, 'clickEffect', 0, fade_body(ids[1], 'visible')),
    effect(ids[2], 2, 'entr', 4, 'clickEffect', 0, fly_body(ids[2])),
    effect(ids[3], 22, 'entr', 8, 'withEffect', 250, wipe_body(ids[3])),
    effect(ids[4], 10, 'exit', 0, 'afterEffect', 0, fade_body(ids[4], 'hidden')),
]
def wrap_click(inner, first=True):
    return f'<p:par><p:cTn id="{{n}}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="{{n}}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>{inner}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>'
steps = wrap_click(effs[0]) + wrap_click(effs[1]) + wrap_click(effs[2] + effs[3]) + wrap_click(effs[4])
xml = (f'<p:timing xmlns:p="{P}"><p:tnLst><p:par><p:cTn id="{{n}}" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>'
       f'<p:seq concurrent="1" nextAc="seek"><p:cTn id="{{n}}" dur="indefinite" nodeType="mainSeq"><p:childTnLst>{steps}</p:childTnLst></p:cTn>'
       f'<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>'
       f'</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>')
n = [0]
def num(m):
    n[0] += 1; return str(n[0])
import re
xml = re.sub(r'\{n\}', num, xml)
s._element.append(etree.fromstring(xml))
prs.save(sys.argv[1])
