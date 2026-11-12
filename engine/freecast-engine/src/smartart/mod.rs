//! SmartArt from DeckCraft (`crates/engine/src/cmd/smartart/`, MIT OR Apache-2.0): its layout
//! files are used unchanged; this module gives them the names they import from DeckCraft's
//! `cmd::smartart` and turns the shapes they lay out into LightCast objects.

pub use deckcraft_color::SchemeSlot;
pub use deckcraft_geom::Xfrm;
pub use deckcraft_model::style::{Gradient, GradientShape, GradientStop, Shadow};
pub use deckcraft_model::text::{Align, AutoFit, Paragraph, TextBody};
pub use deckcraft_model::{ColorRef, ColorTransform, Diagram, DiagramNode, Effects, Fill, Geom, Line, Shape, ShapeStyle};

mod diagrams;
pub mod layout;
#[allow(dead_code)]
pub mod nodes;
pub mod paint;

/// Deepest outline level the Text Pane allows.
pub const MAX_LEVEL: u8 = 8;
/// Most top-level shapes a layout draws.
const MAX_SHAPES: usize = 40;

/// DeckCraft's layouts, with the names PowerPoint's gallery gives them.
pub const LAYOUTS: [(&str, &str); 45] = [
    ("list", "Vertical Bullet List"),
    ("blockList", "Basic Block List"),
    ("hBulletList", "Horizontal Bullet List"),
    ("process", "Basic Process"),
    ("chevron", "Basic Chevron Process"),
    ("verticalProcess", "Vertical Process"),
    ("stepUp", "Step Up Process"),
    ("cycle", "Basic Cycle"),
    ("blockCycle", "Block Cycle"),
    ("radial", "Basic Radial"),
    ("hierarchy", "Hierarchy"),
    ("pyramid", "Basic Pyramid"),
    ("invertedPyramid", "Inverted Pyramid"),
    ("matrix", "Basic Matrix"),
    ("titledMatrix", "Titled Matrix"),
    ("pictureList", "Vertical Picture List"),
    ("pictureCaption", "Picture Caption List"),
    ("pictureProcess", "Picture Accent Process"),
    ("pictureHList", "Horizontal Picture List"),
    ("timeline", "Basic Timeline"),
    ("venn", "Basic Venn"),
    ("target", "Basic Target"),
    ("textCycle", "Text Cycle"),
    ("continuousCycle", "Continuous Cycle"),
    ("horizontalHierarchy", "Horizontal Hierarchy"),
    ("gridMatrix", "Grid Matrix"),
    ("gear", "Gear"),
    ("funnel", "Funnel"),
    ("segmentedCycle", "Segmented Cycle"),
    ("multidirectionalCycle", "Multidirectional Cycle"),
    ("orgChart", "Organization Chart"),
    ("halfCircleOrgChart", "Half Circle Organization Chart"),
    ("cycleMatrix", "Cycle Matrix"),
    ("segmentedPyramid", "Segmented Pyramid"),
    ("pie", "Basic Pie"),
    ("nameTitleOrgChart", "Name and Title Organization Chart"),
    ("verticalBoxList", "Vertical Box List"),
    ("trapezoidList", "Trapezoid List"),
    ("tableList", "Table List"),
    ("accentProcess", "Accent Process"),
    ("continuousBlockProcess", "Continuous Block Process"),
    ("bendingProcess", "Basic Bending Process"),
    ("linearVenn", "Linear Venn"),
    ("stackedVenn", "Stacked Venn"),
    ("nestedTarget", "Nested Target"),
];
/// SmartArt Styles.
pub const STYLES: [(&str, &str); 9] = [
    ("flat", "Simple Fill"),
    ("subtle", "Subtle Effect"),
    ("intense", "Intense Effect"),
    ("outline", "White Outline"),
    ("polished", "Polished"),
    ("inset", "Inset"),
    ("cartoon", "Cartoon"),
    ("powder", "Powder"),
    ("brick", "Brick Scene"),
];
/// Change Colors.
pub const COLORS: [(&str, &str); 17] = [
    ("colorful", "Colorful"),
    ("range23", "Colorful Range - Accent Colors 2 to 3"),
    ("range34", "Colorful Range - Accent Colors 3 to 4"),
    ("range45", "Colorful Range - Accent Colors 4 to 5"),
    ("range56", "Colorful Range - Accent Colors 5 to 6"),
    ("accent1", "Accent 1"),
    ("accent2", "Accent 2"),
    ("accent3", "Accent 3"),
    ("accent4", "Accent 4"),
    ("accent5", "Accent 5"),
    ("accent6", "Accent 6"),
    ("accent1Grad", "Gradient Range - Accent 1"),
    ("accent2Grad", "Gradient Range - Accent 2"),
    ("accent3Grad", "Gradient Range - Accent 3"),
    ("accent4Grad", "Gradient Range - Accent 4"),
    ("accent5Grad", "Gradient Range - Accent 5"),
    ("accent6Grad", "Gradient Range - Accent 6"),
];

/// Lay out `d` in `area` (points): each shape with the node indices it shows.
pub fn items(d: &Diagram, area: Xfrm) -> Vec<(Shape, Vec<usize>)> {
    paint::layout_items(d, area)
}
