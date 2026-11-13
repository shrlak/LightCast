import { BULLET_PICTURE_PX, bulletPictureSize, isBulletPictureFile } from '../../domain/pictureBullet';

/** A chosen image file as the small PNG data URL a 그림 글머리 기호 keeps; null when it cannot be read. */
export async function bulletPictureFromFile(file: File): Promise<string | null> {
  if (!isBulletPictureFile(file)) return null;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const { w, h } = bulletPictureSize(img.naturalWidth || BULLET_PICTURE_PX, img.naturalHeight || BULLET_PICTURE_PX);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
