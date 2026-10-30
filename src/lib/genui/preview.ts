/** What an approval card shows for a proposed write: live "before" values next to the proposed "after". */
export type ActionPreview = {
  title: string;
  link?: string;
  rows: { label: string; before?: string; after: string }[];
  /** Image URLs to show as thumbnails (e.g. photos a new product will get). */
  images?: string[];
  warnings?: string[];
};
