import Link from "next/link";
import { CATEGORIES } from "../../src/config/categories";

// Список категорий, общий для десктоп-сайдбара и мобильного меню — только
// разметка/ссылки, стили (шрифт, отступы, выравнивание) задаёт обёртка
// вызывающего компонента через className.
export default function CategoryNav({
  activeCategory,
  onNavigate,
}: {
  activeCategory?: string;
  onNavigate?: () => void;
}) {
  return (
    <>
      <Link href="/" className={!activeCategory ? "active" : undefined} onClick={onNavigate}>
        Все
      </Link>
      {CATEGORIES.map((c) => (
        <Link
          key={c.id}
          href={`/?category=${c.id}`}
          className={activeCategory === c.id ? "active" : undefined}
          onClick={onNavigate}
        >
          {c.label}
        </Link>
      ))}
    </>
  );
}
