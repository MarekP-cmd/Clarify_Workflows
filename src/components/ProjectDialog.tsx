import { useState, type FormEvent } from 'react'
import type { ClarityProject } from '../../plugin/src/types'
import { Modal } from './Modal'

type Props = {
  project?: ClarityProject
  onCancel: () => void
  onSubmit: (value: { name: string; description: string }) => void
}

export function ProjectDialog({ project, onCancel, onSubmit }: Props) {
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [error, setError] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const cleanName = name.trim()
    if (!cleanName) {
      setError('Enter a side-project name.')
      return
    }
    onSubmit({ name: cleanName, description: description.trim() })
  }

  return (
    <Modal title={project ? 'Edit side project' : 'Create side project'} description="Side projects group related graph items without creating another workspace." onClose={onCancel}>
      <form className="editor-form" onSubmit={submit}>
        {error && <div className="form-error" role="alert">{error}</div>}
        <label className="field">Name <span aria-hidden="true">*</span>
          <input data-autofocus value={name} maxLength={500} onChange={(event) => { setName(event.target.value); setError('') }} />
        </label>
        <label className="field">Description
          <textarea value={description} maxLength={10_000} rows={4} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <div className="modal-actions"><button type="button" className="ghost-button" onClick={onCancel}>Cancel</button><button className="primary-button" type="submit">{project ? 'Save project' : 'Create project'}</button></div>
      </form>
    </Modal>
  )
}
