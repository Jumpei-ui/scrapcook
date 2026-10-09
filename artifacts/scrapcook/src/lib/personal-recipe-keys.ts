export function getPersonalRecipeKeys() {
  try {
    return {
      userSpoonKey: localStorage.getItem("userSpoonKey")?.trim() || "",
      userGemKey: localStorage.getItem("userGemKey")?.trim() || "",
    };
  } catch {
    return { userSpoonKey: "", userGemKey: "" };
  }
}
