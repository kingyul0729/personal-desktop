export interface PriceFolder { id: string; name: string; variant: 'heart' | 'kitty' | 'flower' | 'cherry'; }
export type ImageOrientation = 'landscape' | 'portrait';
export interface PriceImage { id: string; name: string; folderId: string; src: string; variants?: Partial<Record<ImageOrientation, string>>; }
export interface PriceFiles { authenticated: boolean; folders: PriceFolder[]; images: PriceImage[]; }

export const initialPriceFiles: PriceFiles = {
  authenticated: false,
  folders: [
    { id: 'toning', name: '색소·토닝', variant: 'heart' },
    { id: 'acne', name: '여드름·흉터', variant: 'kitty' },
    { id: 'lifting', name: '리프팅', variant: 'flower' },
    { id: 'skinbooster', name: '스킨부스터', variant: 'heart' },
    { id: 'other', name: '기타 프로그램', variant: 'cherry' },
  ],
  images: [
    { id: 'toning-special1', name: '스페셜 토닝 1', folderId: 'toning', src: '/documents/toning-special1-landscape.png', variants: { landscape: '/documents/toning-special1-landscape.png', portrait: '/documents/toning-special1-portrait.png' } },
    { id: 'toning-special2', name: '스페셜 토닝 2', folderId: 'toning', src: '/documents/toning-special2-landscape.png', variants: { landscape: '/documents/toning-special2-landscape.png', portrait: '/documents/toning-special2-portrait.png' } },
    { id: 'toning-special3', name: '스페셜 토닝 3', folderId: 'toning', src: '/documents/toning-special3-landscape.png', variants: { landscape: '/documents/toning-special3-landscape.png', portrait: '/documents/toning-special3-portrait.png' } },
    { id: 'toning-special4', name: '스페셜 토닝 4', folderId: 'toning', src: '/documents/toning-special4.png', variants: { landscape: '/documents/toning-special4.png', portrait: '/documents/toning-special4-portrait.png' } },
    { id: 'toning-dual', name: '듀얼 토닝', folderId: 'toning', src: '/documents/toning-dual-landscape.png', variants: { landscape: '/documents/toning-dual-landscape.png', portrait: '/documents/toning-dual-portrait.png' } },
    { id: 'toning-triple', name: '트리플 토닝', folderId: 'toning', src: '/documents/toning-triple-landscape.png', variants: { landscape: '/documents/toning-triple-landscape.png', portrait: '/documents/toning-triple-portrait.png' } },
    { id: 'toning-lentigo', name: '흑자 제거', folderId: 'toning', src: '/documents/toning-lentigo.png', variants: { landscape: '/documents/toning-lentigo.png', portrait: '/documents/toning-lentigo-portrait.png' } },
    { id: 'lifting-serf', name: '세르프', folderId: 'lifting', src: '/documents/lifting-serf-landscape.jpg', variants: { landscape: '/documents/lifting-serf-landscape.jpg', portrait: '/documents/lifting-serf-portrait.jpg' } },
    { id: 'skinbooster-overview', name: '스킨부스터 3종', folderId: 'skinbooster', src: '/documents/skinbooster-overview-landscape.jpg', variants: { landscape: '/documents/skinbooster-overview-landscape.jpg', portrait: '/documents/skinbooster-overview-portrait.jpg' } },
    { id: 'skinbooster-revive', name: '리바이브', folderId: 'skinbooster', src: '/documents/skinbooster-revive-landscape.jpg', variants: { landscape: '/documents/skinbooster-revive-landscape.jpg', portrait: '/documents/skinbooster-revive-portrait.jpg' } },
    { id: 'skinbooster-re2o', name: '리투오', folderId: 'skinbooster', src: '/documents/skinbooster-re2o-landscape.jpg', variants: { landscape: '/documents/skinbooster-re2o-landscape.jpg', portrait: '/documents/skinbooster-re2o-portrait.jpg' } },
    { id: 'skinbooster-hilowave', name: '힐로웨이브', folderId: 'skinbooster', src: '/documents/skinbooster-hilowave-landscape.jpg', variants: { landscape: '/documents/skinbooster-hilowave-landscape.jpg', portrait: '/documents/skinbooster-hilowave-portrait.jpg' } },
    { id: 'acne-principle', name: '여드름 치료 원리', folderId: 'acne', src: '/documents/acne-principle.png' },
    { id: 'acne-guide', name: '여드름 치료 안내', folderId: 'acne', src: '/documents/acne-guide.png' },
    { id: 'acne-four', name: '여드름 4주 패키지', folderId: 'acne', src: '/documents/acne-four-landscape.png', variants: { landscape: '/documents/acne-four-landscape.png', portrait: '/documents/acne-four-portrait.png' } },
    { id: 'acne-six', name: '여드름 6주 패키지', folderId: 'acne', src: '/documents/acne-six-landscape.png', variants: { landscape: '/documents/acne-six-landscape.png', portrait: '/documents/acne-six-portrait.png' } },
    { id: 'acne-eight', name: '여드름 8주 패키지', folderId: 'acne', src: '/documents/acne-eight-landscape.png', variants: { landscape: '/documents/acne-eight-landscape.png', portrait: '/documents/acne-eight-portrait.png' } },
    { id: 'acne-marks', name: '여드름 자국 지우기', folderId: 'acne', src: '/documents/acne-marks-landscape.png', variants: { landscape: '/documents/acne-marks-landscape.png', portrait: '/documents/acne-marks-portrait.png' } },
  ],
};
