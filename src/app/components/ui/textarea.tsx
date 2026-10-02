import * as React from "react";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={`resize-none min-h-16 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-base outline-none disabled:opacity-50 md:text-sm ${className ?? ''}`}
      {...props}
    />
  );
}

export { Textarea };
