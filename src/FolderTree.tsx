import { useState, type ReactNode } from 'react'
import { Icon } from './Icons'

export const parentFolder = (path: string) => path.split('/').slice(0, -1).join('/')
export const folderName = (path: string) => path.split('/').at(-1) || ''
export const managedFolder = (path: string) => path === 'citations' || path.startsWith('citations/')

export function FolderTree({
  folders,
  selected,
  onSelect,
}: {
  folders: string[]
  selected: string | null
  onSelect: (path: string) => void
}) {
  const [collapsed, setCollapsed] = useState<string[]>([])
  const children = new Map<string, string[]>()
  for (const path of folders) {
    if (!path) continue
    const parent = parentFolder(path)
    children.set(parent, [...(children.get(parent) || []), path])
  }
  for (const siblings of children.values())
    siblings.sort((a, b) =>
      folderName(a).localeCompare(folderName(b), undefined, { numeric: true }),
    )

  const renderFolders = (parent: string): ReactNode => (
    <ul className="folder-tree" aria-label={parent ? `Subfolders of ${parent}` : 'Library folders'}>
      {(children.get(parent) || []).map((path) => {
        const hasChildren = children.has(path)
        const containsSelection = selected?.startsWith(`${path}/`)
        const closed = collapsed.includes(path) && !containsSelection
        return (
          <li key={path}>
            <div className={`folder-row ${selected === path ? 'active' : ''}`}>
              {hasChildren ? (
                <button
                  className="folder-toggle"
                  aria-label={`${closed ? 'Expand' : 'Collapse'} ${path}`}
                  aria-expanded={!closed}
                  onClick={() => {
                    if (containsSelection) onSelect(path)
                    setCollapsed((previous) =>
                      closed ? previous.filter((item) => item !== path) : [...previous, path],
                    )
                  }}
                >
                  <Icon name={closed ? 'right' : 'down'} size={12} />
                </button>
              ) : (
                <span className="folder-toggle-spacer" aria-hidden="true" />
              )}
              <button
                className="folder-select"
                aria-label={path}
                aria-current={selected === path ? 'page' : undefined}
                title={path}
                onClick={() => onSelect(path)}
              >
                <span>{folderName(path)}</span>
                {path === 'citations' && <span aria-hidden="true">↗</span>}
              </button>
            </div>
            {hasChildren && !closed && renderFolders(path)}
          </li>
        )
      })}
    </ul>
  )
  return renderFolders('')
}
