import styles from "@/workspace/icons.module.css";
import branchlightLogo from "@/assets/branchlight-logo.png";

/** Renders the compact Branchlight brand mark used across app screens. */
export function BranchlightMark() {
  return (
    <img className={styles["brand-mark"]} src={branchlightLogo} alt="" width={20} height={20} />
  );
}
