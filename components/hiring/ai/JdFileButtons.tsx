"use client";

import { useTranslations } from "next-intl";
import { ReadFileButton } from "./ReadFileButton";

/** "Read JD from a file" and "Read competencies from a matrix" for the requisition form. */
export function JdFileButtons({
  onDescription,
  onCompetencies,
}: {
  onDescription: (text: string) => void;
  onCompetencies: (names: string[]) => void;
}) {
  const t = useTranslations("hiring.ai");
  return (
    <>
      <ReadFileButton<{ description: string; competencies: string[] }>
        mode="jd"
        label={t("readJd")}
        onResult={(d) => {
          if (d.description) onDescription(d.description);
          if (d.competencies.length) onCompetencies(d.competencies);
        }}
      />
      <ReadFileButton<{ competencies: string[] }>
        mode="competencies"
        label={t("readMatrix")}
        onResult={(d) => onCompetencies(d.competencies)}
      />
    </>
  );
}
