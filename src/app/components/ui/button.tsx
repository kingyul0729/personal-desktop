import * as React from 'react';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'outline' | 'ghost' | 'secondary' | 'destructive' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
};

export function Button({ className = '', variant = 'default', size = 'default', ...props }: ButtonProps) {
  const variants = {
    default: 'bg-blue-600 text-white hover:bg-blue-700',
    outline: 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
    ghost: 'bg-transparent hover:bg-black/10',
    secondary: 'bg-gray-100 text-gray-800',
    destructive: 'bg-red-600 text-white',
    link: 'bg-transparent text-blue-600 underline',
  };
  const sizes = { default: 'h-9 px-4 py-2', sm: 'h-8 px-3', lg: 'h-10 px-6', icon: 'h-9 w-9' };
  return <button className={`inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors ${variants[variant]} ${sizes[size]} ${className}`} {...props} />;
}
