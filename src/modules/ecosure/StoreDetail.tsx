import React, { useState, useEffect } from "react";
import { X, ExternalLink, ChevronRight } from "lucide-react";
import { fetchEcosureStore } from "./api";
import type { EcosureStoreResp, EcosureAssessment, EcosureFinding, RiskRating } from "./types";

const RISK_COLORS: Record<string, string> = {
  "Low Risk":      "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300",
  "Moderate Risk": "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  "High Risk":     "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
};

function RiskBadge({ rating }: { rating: RiskRating | null }) {
  if (!rating) return <span className="text-gray-400 text-xs">—</span>;
  const cls = RISK_COLORS[rating] || "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {rating}
    </span>
  );
}

interface Props {
  storeNumber: string;
  onClose: () => void;
}

export function StoreDetail({ storeNumber, onClose }: Props) {
  const [data, setData]       = useState<EcosureStoreResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setSelectedDate(null);
    fetchEcosureStore(storeNumber)
      .then((d) => {
        setData(d);
        if (d.assessments.length) setSelectedDate(d.assessments[0].assessment_date);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [storeNumber]);

  const selectedAssessment: EcosureAssessment | undefined = data?.assessments.find(
    (a) => a.assessment_date === selectedDate,
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 dark:bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-xl bg-white dark:bg-gray-900 shadow-2xl z-50 flex flex-col overflow-hidden">
        {/* Drawer header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800 shrink-0">
          <div>
            <div className="font-semibold text-gray-900 dark:text-white">
              {data?.store_name ?? storeNumber}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              #{storeNumber}
              {data?.district && <> · {data.district}</>}
              {data?.area && <> · {data.area}</>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>

        {loading && (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            Loading…
          </div>
        )}

        {error && (
          <div className="m-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {!loading && !error && data && (
          <div className="flex-1 overflow-y-auto">
            {/* Assessment history */}
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Assessment History
              </div>
              <div className="space-y-1">
                {data.assessments.map((a) => (
                  <button
                    key={`${a.assessment_date}-${a.visit_type}`}
                    onClick={() => setSelectedDate(a.assessment_date)}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                      a.assessment_date === selectedDate
                        ? "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300"
                        : "hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium shrink-0">{a.assessment_date}</span>
                      <span className="text-xs text-gray-400 truncate">{a.visit_type}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {a.visit_score != null && (
                        <span className={`font-semibold tabular-nums text-xs ${
                          a.visit_score >= 95 ? "text-green-600 dark:text-green-400" :
                          a.visit_score >= 85 ? "text-amber-600 dark:text-amber-400" :
                                                "text-red-600 dark:text-red-400"
                        }`}>
                          {a.visit_score.toFixed(1)}
                        </span>
                      )}
                      <RiskBadge rating={a.visit_rating as RiskRating | null} />
                      {a.report_url && (
                        <a
                          href={a.report_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-blue-500 hover:text-blue-700"
                          title="Open PDF report"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </button>
                ))}
                {data.assessments.length === 0 && (
                  <div className="text-sm text-gray-400 py-2">No assessments on record</div>
                )}
              </div>
            </div>

            {/* Selected assessment detail */}
            {selectedAssessment && (
              <div className="px-5 py-4">
                {/* Score summary */}
                <div className="flex items-center gap-4 mb-4">
                  {selectedAssessment.visit_score != null && (
                    <div>
                      <div className="text-xs text-gray-400 mb-0.5">Visit Score</div>
                      <div className={`text-3xl font-bold ${
                        selectedAssessment.visit_score >= 95 ? "text-green-600 dark:text-green-400" :
                        selectedAssessment.visit_score >= 85 ? "text-amber-600 dark:text-amber-400" :
                                                               "text-red-600 dark:text-red-400"
                      }`}>
                        {selectedAssessment.visit_score.toFixed(1)}
                      </div>
                    </div>
                  )}
                  <div className="flex flex-col gap-1">
                    <RiskBadge rating={selectedAssessment.visit_rating as RiskRating | null} />
                    {selectedAssessment.total_findings != null && (
                      <span className="text-xs text-gray-500">
                        {selectedAssessment.total_findings} total findings
                        {selectedAssessment.imminent_risk ? ` · ${selectedAssessment.imminent_risk} imminent risk` : ""}
                        {selectedAssessment.critical_findings ? ` · ${selectedAssessment.critical_findings} critical` : ""}
                      </span>
                    )}
                  </div>
                </div>

                {/* Findings */}
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                  Findings ({selectedAssessment.findings.length})
                </div>
                {selectedAssessment.findings.length > 0 ? (
                  <div className="space-y-2">
                    {selectedAssessment.findings.map((f: EcosureFinding, i: number) => (
                      <div
                        key={`${f.question_number}-${i}`}
                        className="border border-gray-100 dark:border-gray-800 rounded-lg p-3"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">
                            {f.question_number}
                          </span>
                          {f.primary_response && (
                            <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded px-1.5 py-0.5">
                              {f.primary_response}
                            </span>
                          )}
                        </div>
                        {f.standard_description && (
                          <div className="text-sm text-gray-700 dark:text-gray-300 mb-1">
                            {f.standard_description}
                          </div>
                        )}
                        {f.primary_comment && (
                          <div className="text-xs text-gray-500 italic">
                            "{f.primary_comment}"
                          </div>
                        )}
                        {f.pdc_comment && (
                          <div className="text-xs text-gray-500 mt-1">
                            <span className="font-medium">PDC:</span> {f.pdc_comment}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-gray-400 py-2">No findings for this assessment</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
