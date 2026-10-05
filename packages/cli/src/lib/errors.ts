/**
 * A failure the caller can act on, phrased as one plain sentence.
 *
 * The CLI prints the message as it is and exits 1. The MCP server will return it to the model
 * the same way. So the message names what failed and never carries an RPC URL, which can hold
 * a key.
 */
export class SafenetError extends Error {
  override readonly name = "SafenetError"
}
