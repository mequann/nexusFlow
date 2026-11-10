import type { FormFieldRule } from '../types';

interface DynamicFormProps {
  fields?: FormFieldRule[];
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

export function DynamicForm({ fields, values, onChange }: DynamicFormProps) {
  if (!fields || fields.length === 0) {
    return (
      <div>
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>
          Resolution / Payload JSON
        </label>
        <textarea
          className="textarea"
          rows={4}
          value={JSON.stringify(values, null, 2)}
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value));
            } catch {
              // Keep typing until valid JSON
            }
          }}
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {fields.map((f) => {
        const val = values[f.name];
        const label = `${f.label ?? f.name}${f.required ? ' *' : ''}`;

        if (f.type === 'select') {
          return (
            <div key={f.name}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
                {label}
              </label>
              <select
                className="select"
                value={String(val ?? '')}
                onChange={(e) => onChange({ ...values, [f.name]: e.target.value })}
              >
                <option value="">Select...</option>
                {(f.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        if (f.type === 'boolean') {
          return (
            <label key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={Boolean(val)}
                onChange={(e) => onChange({ ...values, [f.name]: e.target.checked })}
              />
              {label}
            </label>
          );
        }

        const isNum = f.type === 'number' || f.type === 'currency';
        return (
          <div key={f.name}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
              {label}
            </label>
            <input
              className="input"
              type={isNum ? 'number' : f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : 'text'}
              value={val === undefined || val === null ? '' : String(val)}
              placeholder={f.type === 'currency' ? 'e.g. 40000' : `Enter ${f.name}`}
              onChange={(e) =>
                onChange({
                  ...values,
                  [f.name]: isNum ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value,
                })
              }
            />
          </div>
        );
      })}
    </div>
  );
}

