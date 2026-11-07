declare module "nspell" {
  interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
  }
  export default function nspell(dictionary: { aff: Uint8Array; dic: Uint8Array }): NSpell;
}
