# Builds conn.pptx: straight, elbow and curved connectors glued to the sides of two shapes (and one left free), with arrows.
import sys
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
prs = Presentation(); prs.slide_width = Inches(10); prs.slide_height = Inches(7.5)
s = prs.slides.add_slide(prs.slide_layouts[6])
a = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(1), Inches(1), Inches(2), Inches(1)); a.name = 'Box A'
b = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(6), Inches(3), Inches(2), Inches(1)); b.name = 'Box B'
c = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(1), Inches(5), Inches(2), Inches(1)); c.name = 'Oval C'
def conn(kind, x1, y1, x2, y2, name):
    k = s.shapes.add_connector(kind, Inches(x1), Inches(y1), Inches(x2), Inches(y2)); k.name = name
    k.line.width = Pt(2)
    return k
# PowerPoint's connection sites of a rectangle: 0 top, 1 left, 2 bottom, 3 right.
k1 = conn(MSO_CONNECTOR.STRAIGHT, 3, 1.5, 6, 3.5, 'Straight A-B'); k1.begin_connect(a, 3); k1.end_connect(b, 1)
k2 = conn(MSO_CONNECTOR.ELBOW, 2, 2, 7, 3, 'Elbow A-B'); k2.begin_connect(a, 2); k2.end_connect(b, 0)
k3 = conn(MSO_CONNECTOR.CURVE, 3, 5.5, 7, 4, 'Curve C-B'); k3.begin_connect(c, 3); k3.end_connect(b, 2)
k4 = conn(MSO_CONNECTOR.ELBOW, 4, 6.5, 8, 6.9, 'Elbow free')
prs.save(sys.argv[1])
