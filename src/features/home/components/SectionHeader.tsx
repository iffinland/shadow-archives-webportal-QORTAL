import { Link } from 'react-router-dom';

interface SectionHeaderProps {
  readonly id: string;
  readonly title: string;
  readonly linkTo?: string;
  readonly linkLabel?: string;
}

export function SectionHeader({ id, title, linkTo, linkLabel }: SectionHeaderProps) {
  return (
    <div className="sa-section__header">
      <h2 className="sa-section__title" id={id}>
        {title}
      </h2>
      {linkTo && linkLabel ? (
        <Link className="sa-section__more" to={linkTo}>
          {linkLabel}
        </Link>
      ) : null}
    </div>
  );
}
