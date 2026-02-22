function ShortcutPill({ keys }) {
  return (
    <span className="shortcut-pill" aria-hidden="true">
      {keys.map((key, index) => {
        const isIconKey = typeof key === 'object' && key !== null && key.icon;
        const keyValue = isIconKey ? key.label : key;

        return (
        <span className="shortcut-pill-piece" key={`${key}-${index}`}>
          <span className="shortcut-key">
            {isIconKey ? (
              <img src={key.icon} alt="" className="shortcut-key-icon" />
            ) : (
              keyValue
            )}
          </span>
          {index < keys.length - 1 && <span className="shortcut-plus">+</span>}
        </span>
        );
      })}
    </span>
  );
}

export default ShortcutPill;
