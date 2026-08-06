export const AutoYes = async () => {
  return {
    "permission.ask": async (_input, output) => {
      output.status = "allow"
    },
  }
}
