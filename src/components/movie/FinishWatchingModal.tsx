import { useEffect, useState } from 'react';
import Modal from '@/components/common/Modal';
import StarRating from '@/components/common/StarRating';

export interface FinishWatchingData {
  rating: number;
  review: string;
  saveRecord: boolean;
}

interface FinishWatchingModalProps {
  open: boolean;
  movieTitle: string;
  onClose: () => void;
  onComplete: (data: FinishWatchingData) => Promise<void>;
}

export default function FinishWatchingModal({ open, movieTitle, onClose, onComplete }: FinishWatchingModalProps) {
  const [rating, setRating] = useState(8);
  const [review, setReview] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setRating(8);
      setReview('');
    }
  }, [open]);

  async function submit(saveRecord: boolean) {
    setSubmitting(true);
    try {
      await onComplete({ rating: saveRecord ? rating : 0, review: saveRecord ? review : '', saveRecord });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="看完了？" width="420px">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary leading-relaxed">
          「{movieTitle}」已到最后一集。写下此刻的感受，或仅将它标记为已看完。
        </p>
        <div>
          <label className="form-label">个人评分 (0-10)</label>
          <StarRating value={rating} onChange={setRating} size={24} />
        </div>
        <div>
          <label className="form-label">短评</label>
          <textarea
            value={review}
            onChange={(e) => setReview(e.target.value)}
            rows={3}
            className="review-textarea resize-none"
            placeholder="写下你的感受..."
          />
        </div>
        <div className="flex items-center justify-end gap-2.5 pt-1">
          <button onClick={onClose} className="btn btn-ghost" disabled={submitting}>取消</button>
          <button onClick={() => submit(false)} className="btn btn-secondary" disabled={submitting}>仅标记看完</button>
          <button onClick={() => submit(true)} className="btn btn-primary" disabled={submitting}>
            {submitting ? '保存中...' : '保存追剧记录并看完'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
