'use babel'
/** @jsx etch.dom */

import { CompositeDisposable } from 'atom'
import { views } from '../ui'
import { client } from '../connection'

import workspace from './workspace'

let {nextline, stepin, finish, stepexpr, clearbps} =
  client.import(['nextline', 'stepin', 'finish', 'stepexpr', 'clearbps'])

let {togglebp, getbps} = client.import({rpc: ['togglebp', 'getbps']})

let ink, active, stepper, subs, BreakpointRegistry

export function activate() {
  subs = new CompositeDisposable

  client.handle({
    debugmode: state => debugmode(state),
    stepto: (file, line, text) => stepto(file, line, text)
  })

  subs.add(client.onDetached(() => debugmode(false)))

  startListening()
}

export function deactivate() {
  subs.dispose()
}

function activeError() {
  if (!active) {
    atom.notifications.addError("You need to be debugging to do that.", {
      detail: 'You can start debugging by setting a breakpoint,\nor by calling `@step f(args...)`.',
      dismissable: true
    })
    return true
  }
}

function requireDebugging(f) { activeError() || f() }

function debugmode(a) {
  active = a
  if (!active) {
    stepper.destroy()
    workspace.update()
  }
}

function stepto(file, line, text) {
  stepper.goto(file, line-1)
  stepper.setText(views.render(text))
  workspace.update()
}

export function nextline() { requireDebugging(() => nextline()) }
export function stepin()   { requireDebugging(() => stepin()) }
export function finish()   { requireDebugging(() => finish()) }
export function stepexpr() { requireDebugging(() => stepexpr()) }

let breakpoints = []
let odcm

// logic for activating breakpoints for saved files and deactivating when
// they are modified
function startListening() {
  subs.add(atom.workspace.observeTextEditors(ed => {
    subs.add(ed.observeGrammar(g => {
      if (g.scopeName === 'source.julia') {
        let buffer = ed.getBuffer()
        buffer.onDidChangeModified(m => {
          let file = buffer.getPath()
          let bp
          // unsaved changes in buffer -> deactivate all breakpoints
          if (m === true) {
            // clear the breakpoints in gallium
            for (bp of breakpoints) {
              if (bp.file === file) {
                togglebp(bp.file, bp.line+1).then(r => {
                  if (r.msg !== 'bpremoved') {
                    console.error('inconsistent status!')
                  }
                })
                bp.updateLineToMarkerPosition()
              }
            }
            // and set them to inactive in atom
            for (bp of breakpoints) {
              if (bp.file === file) {
                bp.origStatus = bp.status
                bp.status = 'inactive'
              }
            }
          } else {
            // reset status for all breakpoints
            for (bp of breakpoints) {
              if (bp.file === file) {
                bp.status = bp.origStatus
                bp.updateLineToMarkerPosition()
              }
            }
            // and set them in gallium
            for (bp of breakpoints) {
              if (bp.file === file) {
                togglebp(bp.file, bp.line+1).then(r => {
                  if (r.msg !== 'bpset') {
                    console.error('inconsistent status!')
                  }
                })
              }
            }
          }
        })
      }
    }))
  }))
}

function bufferForFile(file) {
  let ed
  for (ed of atom.workspace.getTextEditors()) {
    if (ed.getBuffer().getPath() === file) {
      return ed.getBuffer()
    }
  }
  return null
}

function bp(file, line) {
  let i = breakpoints.findIndex(bp => bp.file === file && bp.line === line)
  let modified = bufferForFile(file).isModified()

  if (i > -1) {
    console.log('destroying');
    let bp = breakpoints[i]
    breakpoints.splice(i, 1)
    bp.destroy()

    if (modified === false) {
      togglebp(file, line+1).then(r => {
        if (r.msg !== 'bpremoved') {
          console.error('inconsistent status!')
        }
      })
    }
  } else {
    console.log('constructing');
    breakpoints.push(BreakpointRegistry.add(file, line, modified ? 'inactive' : 'active'))

    if (modified === false) {
      togglebp(file, line+1).then(r => {
        if (r.msg !== 'bpset') {
          console.error('inconsistent status!')
        }
      })
    }
  }
}

export function clearall() {
  breakpoints.forEach((bp) => bp.destroy())
  clearbps()
}

export function getBPs() {
  console.log(getbps())
}

export function togglebp(ed = atom.workspace.getActiveTextEditor()) {
  if (!ed) return
  ed.getCursors().map((cursor) =>
    bp(ed.getPath(), cursor.getBufferPosition().row))
}

export function consumeInk(i) {
  ink = i
  stepper = new ink.Stepper({
    buttons: [
      {icon: 'link-external', command: 'julia-debug:finish-function'},
      {icon: 'triangle-right', command: 'julia-debug:step-to-next-expression'},
      {icon: 'sign-in', command: 'julia-debug:step-into-function'}
    ]
  })
  BreakpointRegistry = new ink.breakpoints('source.julia')
}