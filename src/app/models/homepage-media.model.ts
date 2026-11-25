import { MEDIA } from '../config/media-assets';

export interface HomepageImage { src: string; alt: string; }
export interface InstagramMedia extends HomepageImage { type: 'image' | 'video'; url: string; }
export interface HomepageMedia {
  heroImages: HomepageImage[];
  adVideoUrl: string;
  adVideoPosterUrl: string;
  instagramPosts: InstagramMedia[];
  instagramProfileUrl: string;
  revision: number;
  updatedAt?: string;
}

export const DEFAULT_HOMEPAGE_MEDIA: HomepageMedia = {
  heroImages: MEDIA.hero.posters.map((src, index) => ({ src, alt: `Monk Hagen collection banner ${index + 1}` })),
  adVideoUrl: 'https://pub-72df2dffccc643c59aebafe55e835d7b.r2.dev/Instagram/insta3.mp4',
  adVideoPosterUrl: '',
  instagramPosts: MEDIA.instagram.posts.map(post => ({ ...post, type: post.type as 'image' | 'video', alt: 'Monk Hagen on Instagram' })),
  instagramProfileUrl: MEDIA.instagram.profileUrl,
  revision: 0
};
