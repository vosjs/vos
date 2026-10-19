/**
 * Code inlined into a `<script>` element. The HTML parser ends a script
 * element at the first `</script` it sees, whatever the JavaScript around
 * it is doing, and treats `<!--` specially too, so a program whose source
 * holds either (in a string, a comment, a regex) would end the capture
 * page's script where it stands. Both sequences leave with a backslash,
 * which JavaScript reads back as the same characters wherever they can
 * legally occur. Playback loads the program through a blob and needs no
 * such care; the capture templates inline it.
 */
export function inlineScriptSafe(code: string): string {
  return code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')
}
