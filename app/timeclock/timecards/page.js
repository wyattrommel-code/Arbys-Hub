import { OfflineReviewNotice } from "@/components/timecards/OfflineReview";
import TimecardsBoard from "@/components/timecards/TimecardsBoard";

export const metadata = {
  title: "Timecards | Arby's Ops",
};

export default function TimeClockTimecardsPage() {
  return <><OfflineReviewNotice /><TimecardsBoard /></>;
}
