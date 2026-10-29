import branchlightLogo from "@/assets/branchlight-logo.png";

/** Renders the compact Branchlight brand mark used across app screens. */
export function BranchlightMark() {
  return (
    <img className="brand-mark" src={branchlightLogo} alt="" width={22} height={22} />
  );
}
