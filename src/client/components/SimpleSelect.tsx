import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";

/** A select over a short list of string options. */
export function SimpleSelect({
  value,
  onChange,
  options,
  label,
  testId,
  size,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  label: string;
  testId?: string;
  size?: "sm" | "default";
  className?: string;
}) {
  return (
    <Select
      items={options}
      value={value}
      onValueChange={(v) => {
        if (v !== null) onChange(v);
      }}
    >
      <SelectTrigger aria-label={label} data-testid={testId} size={size} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
