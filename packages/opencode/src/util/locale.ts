export namespace Locale {
  export function titlecase(str: string) {
    return str.replace(/\b\w/g, (c) => c.toUpperCase())
  }

  export function time(input: number) {
    const date = new Date(input)
    return date.toLocaleTimeString()
  }
}
