import { useCallback, useState } from 'react';
import type { A2UISurface, A2UIBoundValue } from '../types';
import styles from './A2UIRenderer.module.css';

interface A2UIRendererProps {
  surface: A2UISurface;
  onUserAction?: (actionName: string, context: Record<string, unknown>) => void;
}

/**
 * Tabs wrapper — manages active tab state.
 */
function TabsComponent({
  id,
  tabItems,
  renderComponent,
  surface,
  flexStyle,
}: {
  id: string;
  tabItems: Array<{ title: A2UIBoundValue; child: string }>;
  renderComponent: (id: string) => React.ReactNode;
  surface: A2UISurface;
  flexStyle?: React.CSSProperties;
}) {
  const [activeTab, setActiveTab] = useState(0);
  return (
    <div key={id} className={styles.tabs} style={flexStyle}>
      <div className={styles.tabBar}>
        {tabItems.map((item, i) => (
          <button
            key={`tab-${i}`}
            className={`${styles.tabButton} ${i === activeTab ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab(i)}
          >
            {resolveBoundValue(
              typeof item.title === 'string' ? { literalString: item.title } : item.title,
              surface.dataModel
            )}
          </button>
        ))}
      </div>
      <div className={styles.tabContent}>
        {tabItems[activeTab] && renderComponent(tabItems[activeTab].child)}
      </div>
    </div>
  );
}

/**
 * Modal wrapper — manages open/close state.
 */
function ModalComponent({
  id,
  entryPointChild,
  contentChild,
  renderComponent,
  flexStyle,
}: {
  id: string;
  entryPointChild: string;
  contentChild: string;
  renderComponent: (id: string) => React.ReactNode;
  flexStyle?: React.CSSProperties;
}) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div key={id} style={flexStyle}>
      <div onClick={() => setIsOpen(true)} style={{ cursor: 'pointer' }}>
        {renderComponent(entryPointChild)}
      </div>
      {isOpen && (
        <div className={styles.modalOverlay} onClick={() => setIsOpen(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setIsOpen(false)}>✕</button>
            {renderComponent(contentChild)}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * MultipleChoice wrapper — manages selection state.
 */
function MultipleChoiceComponent({
  id,
  options,
  maxAllowedSelections,
  surface,
  flexStyle,
}: {
  id: string;
  options: Array<{ label: A2UIBoundValue; value: string }>;
  maxAllowedSelections?: number;
  surface: A2UISurface;
  flexStyle?: React.CSSProperties;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const isSingleSelect = maxAllowedSelections === 1;

  const toggle = (value: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        if (isSingleSelect) {
          return new Set([value]);
        }
        if (maxAllowedSelections && next.size >= maxAllowedSelections) return prev;
        next.add(value);
      }
      return next;
    });
  };

  return (
    <div key={id} className={styles.multipleChoice} style={flexStyle}>
      {options.map((opt, i) => {
        const label = resolveBoundValue(
          typeof opt.label === 'string' ? { literalString: opt.label } : opt.label,
          surface.dataModel
        );
        const isSelected = selected.has(opt.value);
        return (
          <label
            key={`mc-${i}`}
            className={`${styles.choiceOption} ${isSelected ? styles.choiceOptionSelected : ''}`}
          >
            <input
              type={isSingleSelect ? 'radio' : 'checkbox'}
              name={`mc-${id}`}
              checked={isSelected}
              onChange={() => toggle(opt.value)}
            />
            {label}
          </label>
        );
      })}
    </div>
  );
}

/**
 * Slider wrapper — manages value state.
 */
function SliderComponent({
  id,
  initialValue,
  minValue = 0,
  maxValue = 100,
  flexStyle,
}: {
  id: string;
  initialValue: number;
  minValue?: number;
  maxValue?: number;
  flexStyle?: React.CSSProperties;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <div key={id} className={styles.slider} style={flexStyle}>
      <input
        type="range"
        min={minValue}
        max={maxValue}
        value={value}
        onChange={e => setValue(Number(e.target.value))}
        className={styles.sliderInput}
      />
      <span className={styles.sliderValue}>{value}</span>
    </div>
  );
}

/**
 * Resolve a BoundValue to a display string.
 * Checks the data model for path bindings, falls back to literal.
 */
function resolveBoundValue(bv: A2UIBoundValue | undefined, dataModel: Map<string, unknown>): string {
  if (!bv) return '';

  // If bv is a plain string (Gemini sometimes returns the value directly)
  if (typeof bv === 'string') return bv;
  if (typeof bv === 'number') return String(bv);

  // Try path first
  if (bv.path) {
    const segments = bv.path.split('/').filter(Boolean);
    let current: unknown = dataModel;
    for (const seg of segments) {
      if (current instanceof Map) {
        current = current.get(seg);
      } else if (typeof current === 'object' && current !== null) {
        current = (current as Record<string, unknown>)[seg];
      } else {
        current = undefined;
        break;
      }
    }
    if (current !== undefined && current !== null) {
      return String(current);
    }
  }

  // Fallback to literal
  if (bv.literalString !== undefined) return bv.literalString;
  if (bv.literalNumber !== undefined) return String(bv.literalNumber);
  if (bv.literalBoolean !== undefined) return String(bv.literalBoolean);
  if (bv.literalArray !== undefined) return bv.literalArray.join(', ');

  return '';
}

/**
 * Extract a BoundValue from a component definition, handling Gemini's
 * tendency to flatten nested keys. For a property "text" it checks:
 *   - def.text (nested object with literalString/path/etc.)
 *   - def.text_literalString (flattened string literal)
 *   - def.text_literalNumber (flattened number literal)
 *   - def.text_path (flattened path binding)
 *   - def.text as a plain string (direct value)
 */
function extractBoundValue(def: Record<string, unknown>, propName: string): A2UIBoundValue | undefined {
  const val = def[propName];

  // Standard nested format: { literalString: "..." }
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    return val as A2UIBoundValue;
  }

  // Direct string value: text: "Hello"
  if (typeof val === 'string') {
    return { literalString: val } as A2UIBoundValue;
  }

  // Direct number value: text: 42
  if (typeof val === 'number') {
    return { literalNumber: val } as A2UIBoundValue;
  }

  // Flattened keys: text_literalString, text_literalNumber, text_path
  const flatStr = def[`${propName}_literalString`];
  if (typeof flatStr === 'string') return { literalString: flatStr } as A2UIBoundValue;

  const flatNum = def[`${propName}_literalNumber`];
  if (typeof flatNum === 'number') return { literalNumber: flatNum } as A2UIBoundValue;

  const flatPath = def[`${propName}_path`];
  if (typeof flatPath === 'string') return { path: flatPath } as A2UIBoundValue;

  return undefined;
}

/**
 * Known component property names that are NOT child IDs.
 * Used to filter when Gemini deeply-flattens children into sibling keys.
 */
const KNOWN_COMPONENT_PROPS = new Set([
  'children', 'children_explicitList', 'child', 'direction', 'axis',
  'text', 'text_literalString', 'text_literalNumber', 'text_path',
  'usageHint', 'label', 'label_literalString', 'url', 'url_literalString',
  'icon', 'name', 'name_literalString', 'action', 'enableTime', 'explicitList',
  'distribution', 'alignment', 'primary', 'validationRegexp',
  'tabItems', 'entryPointChild', 'contentChild',
  'selections', 'options', 'maxAllowedSelections',
  'value', 'minValue', 'maxValue',
]);

/**
 * Map A2UI distribution values to CSS justify-content.
 */
const DISTRIBUTION_MAP: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  spaceBetween: 'space-between',
  spaceAround: 'space-around',
  spaceEvenly: 'space-evenly',
};

/**
 * Map A2UI alignment values to CSS align-items.
 */
const ALIGNMENT_MAP: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
};

/**
 * Build inline style for layout distribution and alignment.
 */
function buildLayoutStyle(
  def: Record<string, unknown>,
  flexStyle: React.CSSProperties | undefined
): React.CSSProperties | undefined {
  const distribution = def.distribution as string | undefined;
  const alignment = def.alignment as string | undefined;
  const justifyContent = distribution ? DISTRIBUTION_MAP[distribution] : undefined;
  const alignItems = alignment ? ALIGNMENT_MAP[alignment] : undefined;

  if (!justifyContent && !alignItems && !flexStyle) return undefined;

  return {
    ...flexStyle,
    ...(justifyContent && { justifyContent }),
    ...(alignItems && { alignItems }),
  };
}

/**
 * Render simple Markdown to React nodes.
 * Supports: **bold**, *italic*, `code`, [text](url)
 */
function renderMarkdown(text: string): React.ReactNode[] {
  // Regex to match markdown tokens in order of precedence
  const pattern = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|(\[(.+?)\]\((.+?)\))/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    // Push preceding plain text
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // **bold**
      nodes.push(<strong key={`md-${key++}`}>{match[2]}</strong>);
    } else if (match[3]) {
      // *italic*
      nodes.push(<em key={`md-${key++}`}>{match[4]}</em>);
    } else if (match[5]) {
      // `code`
      nodes.push(<code key={`md-${key++}`} className={styles.inlineCode}>{match[6]}</code>);
    } else if (match[7]) {
      // [text](url)
      nodes.push(
        <a key={`md-${key++}`} href={match[9]} target="_blank" rel="noopener noreferrer">
          {match[8]}
        </a>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Push remaining text
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

/**
 * Safely extract child IDs from a component definition.
 * Gemini's JSON mode may flatten nested keys, so we handle multiple formats:
 *   { children: { explicitList: [...] } }  — ideal A2UI
 *   { children_explicitList: [...] }        — flattened by Gemini
 *   { children: [...] }                     — simplified array
 *   { children: "single_id" }              — single string (real child ID)
 *   { children: "explicitList", id1: "v", id2: "v" } — deeply flattened by Gemini
 *     In this last case, "children" gets the literal string "explicitList" and the
 *     actual child IDs become sibling keys of the object.
 */
function resolveChildIds(def: Record<string, unknown>): string[] {
  // Standard nested format
  const children = def.children as Record<string, unknown> | string[] | string | undefined;
  if (children) {
    if (typeof children === 'object' && !Array.isArray(children) && children !== null) {
      const list = (children as Record<string, unknown>).explicitList;
      if (Array.isArray(list)) return list as string[];
    }
    if (Array.isArray(children)) return children as string[];
    // Deeply-flattened: children === "explicitList" and real child IDs are sibling keys
    if (typeof children === 'string' && children === 'explicitList') {
      const ids = Object.keys(def).filter(k => !KNOWN_COMPONENT_PROPS.has(k));
      if (ids.length > 0) return ids;
    }
    // Single child ID as string
    if (typeof children === 'string') return [children];
  }
  // Flattened key
  const flat = def.children_explicitList;
  if (Array.isArray(flat)) return flat as string[];
  // Nothing found
  return [];
}

/**
 * Safely extract a single child ID from a component definition.
 * Handles: { child: "id" } or missing.
 */
function resolveChildId(def: Record<string, unknown>): string | undefined {
  const child = def.child;
  if (typeof child === 'string') return child;
  // Sometimes model nests it
  const children = resolveChildIds(def);
  return children.length > 0 ? children[0] : undefined;
}

/**
 * Renders an A2UI surface — walks the component adjacency list
 * starting from the root and recursively renders React elements.
 */
export function A2UIRenderer({ surface, onUserAction }: A2UIRendererProps) {
  const componentMap = new Map(surface.components.map(entry => [entry.id, entry]));
  const primaryColor = surface.styles?.primaryColor || '#1565C0';

  console.log('[A2UIRenderer] Rendering surface:', {
    surfaceId: surface.surfaceId,
    rootId: surface.rootId,
    componentCount: surface.components.length,
    componentIds: surface.components.map(c => c.id),
    componentKeys: surface.components.map(c => ({ id: c.id, keys: Object.keys(c.component) })),
  });

  const renderComponent = useCallback((id: string): React.ReactNode => {
    const entry = componentMap.get(id);
    if (!entry) {
      console.warn(`[A2UIRenderer] Component "${id}" not found in componentMap`);
      return null;
    }

    const def = entry.component;
    console.log(`[A2UIRenderer] Rendering "${id}":`, JSON.stringify(def).substring(0, 200));
    const weight = entry.weight;
    const flexStyle = weight !== undefined ? { flex: weight } : undefined;

    // Column
    if (def.Column) {
      const colDef = def.Column as Record<string, unknown>;
      const childIds = resolveChildIds(colDef);
      const layoutStyle = buildLayoutStyle(colDef, flexStyle);
      return (
        <div key={id} className={styles.column} style={layoutStyle}>
          {childIds.map(cid => renderComponent(cid))}
        </div>
      );
    }

    // Row
    if (def.Row) {
      const rowDef = def.Row as Record<string, unknown>;
      const childIds = resolveChildIds(rowDef);
      const layoutStyle = buildLayoutStyle(rowDef, flexStyle);
      return (
        <div key={id} className={styles.row} style={layoutStyle}>
          {childIds.map(cid => renderComponent(cid))}
        </div>
      );
    }

    // Text
    if (def.Text) {
      const textDef = def.Text as Record<string, unknown>;
      const bv = extractBoundValue(textDef, 'text');
      const text = resolveBoundValue(bv, surface.dataModel);
      const hint = (textDef.usageHint as string) || 'body';
      const className = styles[hint] || styles.textDefault;
      const Tag = hint.startsWith('h') && hint.length === 2 ? hint as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' : 'p';
      return <Tag key={id} className={className} style={flexStyle}>{renderMarkdown(text)}</Tag>;
    }

    // Card
    if (def.Card) {
      const childId = resolveChildId(def.Card as Record<string, unknown>);
      return (
        <div key={id} className={styles.card} style={flexStyle}>
          {childId && renderComponent(childId)}
        </div>
      );
    }

    // List
    if (def.List) {
      const childIds = resolveChildIds(def.List as Record<string, unknown>);
      const isHorizontal = (def.List as Record<string, unknown>).direction === 'horizontal';
      const listClass = `${styles.list} ${isHorizontal ? styles.listHorizontal : ''}`;
      return (
        <ul key={id} className={listClass} style={flexStyle}>
          {childIds.map(cid => (
            <li key={cid}>{renderComponent(cid)}</li>
          ))}
        </ul>
      );
    }

    // Button
    if (def.Button) {
      const btnDef = def.Button as Record<string, unknown>;
      const handleClick = () => {
        if (onUserAction && btnDef.action) {
          const action = btnDef.action as { name: string; context?: { key: string; value: A2UIBoundValue }[] };
          const context: Record<string, unknown> = {};
          for (const kv of action.context || []) {
            context[kv.key] = resolveBoundValue(kv.value, surface.dataModel);
          }
          onUserAction(action.name, context);
        }
      };
      const btnChildId = resolveChildId(btnDef);
      return (
        <button
          key={id}
          className={styles.button}
          style={{ backgroundColor: primaryColor, color: 'white', ...flexStyle }}
          onClick={handleClick}
        >
          {btnChildId && renderComponent(btnChildId)}
        </button>
      );
    }

    // TextField
    if (def.TextField) {
      const tfDef = def.TextField as Record<string, unknown>;
      const label = resolveBoundValue(extractBoundValue(tfDef, 'label'), surface.dataModel);
      const value = resolveBoundValue(extractBoundValue(tfDef, 'text'), surface.dataModel);
      return (
        <div key={id} className={styles.textField} style={flexStyle}>
          {label && <label className={styles.textFieldLabel}>{label}</label>}
          <input className={styles.textFieldInput} type="text" defaultValue={value} readOnly />
        </div>
      );
    }

    // Divider
    if (def.Divider) {
      const divDef = def.Divider as Record<string, unknown>;
      const isVertical = divDef.axis === 'vertical';
      return <hr key={id} className={isVertical ? styles.dividerVertical : styles.divider} />;
    }

    // Image
    if (def.Image) {
      const imgDef = def.Image as Record<string, unknown>;
      const url = resolveBoundValue(extractBoundValue(imgDef, 'url'), surface.dataModel);
      return <img key={id} className={styles.image} src={url} alt="" style={flexStyle} />;
    }

    // Icon
    if (def.Icon) {
      const iconDef = def.Icon as Record<string, unknown>;
      const iconName = resolveBoundValue(
        extractBoundValue(iconDef, 'name') || extractBoundValue(iconDef, 'icon'),
        surface.dataModel
      );
      return <span key={id} className={styles.icon} style={flexStyle}>{iconName}</span>;
    }

    // CheckBox
    if (def.CheckBox) {
      const cbDef = def.CheckBox as Record<string, unknown>;
      const label = resolveBoundValue(extractBoundValue(cbDef, 'label'), surface.dataModel);
      return (
        <label key={id} className={styles.checkbox} style={flexStyle}>
          <input type="checkbox" readOnly />
          {label}
        </label>
      );
    }

    // DateTimeInput
    if (def.DateTimeInput) {
      const dtDef = def.DateTimeInput as Record<string, unknown>;
      return (
        <input
          key={id}
          className={styles.dateInput}
          type={dtDef.enableTime ? 'datetime-local' : 'date'}
          readOnly
          style={flexStyle}
        />
      );
    }

    // Tabs
    if (def.Tabs) {
      const tabsDef = def.Tabs as Record<string, unknown>;
      const tabItems = (tabsDef.tabItems as Array<{ title: A2UIBoundValue; child: string }>) || [];
      return (
        <TabsComponent
          key={id}
          id={id}
          tabItems={tabItems}
          renderComponent={renderComponent}
          surface={surface}
          flexStyle={flexStyle}
        />
      );
    }

    // Modal
    if (def.Modal) {
      const modalDef = def.Modal as Record<string, unknown>;
      const entryPointChild = modalDef.entryPointChild as string;
      const contentChild = modalDef.contentChild as string;
      if (entryPointChild && contentChild) {
        return (
          <ModalComponent
            key={id}
            id={id}
            entryPointChild={entryPointChild}
            contentChild={contentChild}
            renderComponent={renderComponent}
            flexStyle={flexStyle}
          />
        );
      }
    }

    // MultipleChoice
    if (def.MultipleChoice) {
      const mcDef = def.MultipleChoice as Record<string, unknown>;
      const options = (mcDef.options as Array<{ label: A2UIBoundValue; value: string }>) || [];
      const maxAllowed = mcDef.maxAllowedSelections as number | undefined;
      return (
        <MultipleChoiceComponent
          key={id}
          id={id}
          options={options}
          maxAllowedSelections={maxAllowed}
          surface={surface}
          flexStyle={flexStyle}
        />
      );
    }

    // Slider
    if (def.Slider) {
      const sliderDef = def.Slider as Record<string, unknown>;
      const bv = extractBoundValue(sliderDef, 'value');
      const initial = Number(resolveBoundValue(bv, surface.dataModel)) || 0;
      const min = sliderDef.minValue as number | undefined;
      const max = sliderDef.maxValue as number | undefined;
      return (
        <SliderComponent
          key={id}
          id={id}
          initialValue={initial}
          minValue={min}
          maxValue={max}
          flexStyle={flexStyle}
        />
      );
    }

    // Unknown component
    console.warn(`[A2UIRenderer] Unknown component type for id="${id}"`);
    return null;
  }, [componentMap, surface.dataModel, primaryColor, onUserAction]);

  return (
    <div className={styles.renderer} style={{ color: '#333' }}>
      {renderComponent(surface.rootId)}
    </div>
  );
}
