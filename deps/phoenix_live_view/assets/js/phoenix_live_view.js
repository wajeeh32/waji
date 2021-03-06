/*
================================================================================
Phoenix LiveView JavaScript Client
================================================================================

See the hexdocs at `https://hexdocs.pm/phoenix_live_view` for documentation.

*/

import morphdom from "morphdom"

const CONSECUTIVE_RELOADS = "consecutive-reloads"
const MAX_RELOADS = 10
const RELOAD_JITTER = [1000, 3000]
const FAILSAFE_JITTER = 30000
const PHX_VIEW = "data-phx-view"
const PHX_EVENT_CLASSES = [
  "phx-click-loading", "phx-change-loading", "phx-submit-loading",
  "phx-keydown-loading", "phx-keyup-loading", "phx-blur-loading", "phx-focus-loading"
]
const PHX_COMPONENT = "data-phx-component"
const PHX_LIVE_LINK = "data-phx-link"
const PHX_TRACK_STATIC = "track-static"
const PHX_LINK_STATE = "data-phx-link-state"
const PHX_REF = "data-phx-ref"
const PHX_SKIP = "data-phx-skip"
const PHX_REMOVE = "data-phx-remove"
const PHX_PAGE_LOADING = "page-loading"
const PHX_CONNECTED_CLASS = "phx-connected"
const PHX_DISCONNECTED_CLASS = "phx-disconnected"
const PHX_NO_FEEDBACK_CLASS = "phx-no-feedback"
const PHX_ERROR_CLASS = "phx-error"
const PHX_PARENT_ID = "data-phx-parent-id"
const PHX_VIEW_SELECTOR = `[${PHX_VIEW}]`
const PHX_MAIN = `data-phx-main`
const PHX_ROOT_ID = `data-phx-root-id`
const PHX_TRIGGER_ACTION = "trigger-action"
const PHX_FEEDBACK_FOR = "feedback-for"
const PHX_HAS_FOCUSED = "phx-has-focused"
const FOCUSABLE_INPUTS = ["text", "textarea", "number", "email", "password", "search", "tel", "url", "date", "time"]
const CHECKABLE_INPUTS = ["checkbox", "radio"]
const PHX_HAS_SUBMITTED = "phx-has-submitted"
const PHX_SESSION = "data-phx-session"
const PHX_STATIC = "data-phx-static"
const PHX_READONLY = "data-phx-readonly"
const PHX_DISABLED = "data-phx-disabled"
const PHX_DISABLE_WITH = "disable-with"
const PHX_DISABLE_WITH_RESTORE = "data-phx-disable-with-restore"
const PHX_HOOK = "hook"
const PHX_DEBOUNCE = "debounce"
const PHX_THROTTLE = "throttle"
const PHX_CHANGE_EVENT = "phx-change"
const PHX_UPDATE = "update"
const PHX_KEY = "key"
const PHX_PRIVATE = "phxPrivate"
const PHX_AUTO_RECOVER = "auto-recover"
const PHX_LV_DEBUG = "phx:live-socket:debug"
const PHX_LV_PROFILE = "phx:live-socket:profiling"
const PHX_LV_LATENCY_SIM = "phx:live-socket:latency-sim"
const LOADER_TIMEOUT = 1
const BEFORE_UNLOAD_LOADER_TIMEOUT = 200
const BINDING_PREFIX = "phx-"
const PUSH_TIMEOUT = 30000
const LINK_HEADER = "x-requested-with"
const RESPONSE_URL_HEADER = "x-response-url"
const DEBOUNCE_BLUR = "debounce-blur"
const DEBOUNCE_TIMER = "debounce-timer"
const DEBOUNCE_BLUR_TIMER = "debounce-blur-timer"
const DEBOUNCE_PREV_KEY = "debounce-prev-key"
const DEFAULTS = {
  debounce: 300,
  throttle: 300
}

// Rendered
const DYNAMICS = "d"
const STATIC = "s"
const COMPONENTS = "c"


let logError = (msg, obj) => console.error && console.error(msg, obj)

function detectDuplicateIds() {
  let ids = new Set()
  let elems = document.querySelectorAll('*[id]')
  for (let i = 0, len = elems.length; i < len; i++) {
    if (ids.has(elems[i].id)) {
      console.error(`Multiple IDs detected: ${elems[i].id}. Ensure unique element ids.`)
    } else {
      ids.add(elems[i].id)
    }
  }
}

export let debug = (view, kind, msg, obj) => {
  if(view.liveSocket.isDebugEnabled()){
    console.log(`${view.id} ${kind}: ${msg} - `, obj)
  }
}

// wraps value in closure or returns closure
let closure = (val) => typeof val === "function" ? val : function(){ return val }

let clone = (obj) => { return JSON.parse(JSON.stringify(obj)) }

let closestPhxBinding = (el, binding, borderEl) => {
  do {
    if(el.matches(`[${binding}]`)){ return el }
    el = el.parentElement || el.parentNode
  } while(el !== null && el.nodeType === 1 && !((borderEl && borderEl.isSameNode(el)) || el.matches(PHX_VIEW_SELECTOR)))
  return null
}

let isObject = (obj) => {
  return obj !== null && typeof obj === "object" && !(obj instanceof Array)
}

let isEqualObj = (obj1, obj2) =>  JSON.stringify(obj1) === JSON.stringify(obj2)

let isEmpty = (obj) => {
  for (let x in obj){ return false }
  return true
}

let maybe = (el, callback) => el && callback(el)

let serializeForm = (form, meta = {}) => {
  let formData = new FormData(form)
  let params = new URLSearchParams()
  for(let [key, val] of formData.entries()){ params.append(key, val) }
  for(let metaKey in meta){ params.append(metaKey, meta[metaKey]) }

  return params.toString()
}

export class Rendered {
  constructor(viewId, rendered){
    this.viewId = viewId
    this.replaceRendered(rendered)
  }

  parentViewId(){ return this.viewId }

  toString(onlyCids){
    return this.recursiveToString(this.rendered, this.rendered[COMPONENTS], onlyCids)
  }

  recursiveToString(rendered, components = rendered[COMPONENTS] || {}, onlyCids){
    onlyCids = onlyCids ? new Set(onlyCids) : null
    let output = {buffer: "", components: components, onlyCids: onlyCids}
    this.toOutputBuffer(rendered, output)
    return output.buffer
  }

  componentCIDs(diff){ return Object.keys(diff[COMPONENTS] || {}).map(i => parseInt(i)) }

  isComponentOnlyDiff(diff){
    if(!diff[COMPONENTS]){ return false }
    return Object.keys(diff).filter(k => k !== "title" && k !== COMPONENTS).length === 0
  }

  mergeDiff(diff){
    if(!diff[COMPONENTS] && this.isNewFingerprint(diff)){
      this.replaceRendered(diff)
    } else {
      this.recursiveMerge(this.rendered, diff)
    }
  }

  recursiveMerge(target, source){
    for(let key in source){
      let val = source[key]
      let targetVal = target[key]
      if(isObject(val) && isObject(targetVal)){
        if(targetVal[DYNAMICS] && !val[DYNAMICS]){ delete targetVal[DYNAMICS] }
        this.recursiveMerge(targetVal, val)
      } else {
        target[key] = val
      }
    }
  }

  componentToString(cid){ return this.recursiveCIDToString(this.rendered[COMPONENTS], cid) }

  pruneCIDs(cids){
    cids.forEach(cid => delete this.rendered[COMPONENTS][cid])
  }

  // private

  get(){ return this.rendered }

  replaceRendered(rendered){
    this.rendered = rendered
    this.rendered[COMPONENTS] = this.rendered[COMPONENTS] || {}
  }

  isNewFingerprint(diff = {}){ return !!diff[STATIC] }

  toOutputBuffer(rendered, output){
    if(rendered[DYNAMICS]){ return this.comprehensionToBuffer(rendered, output) }
    let {[STATIC]: statics} = rendered

    output.buffer += statics[0]
    for(let i = 1; i < statics.length; i++){
      this.dynamicToBuffer(rendered[i - 1], output)
      output.buffer += statics[i]
    }
  }

  comprehensionToBuffer(rendered, output){
    let {[DYNAMICS]: dynamics, [STATIC]: statics} = rendered

    for(let d = 0; d < dynamics.length; d++){
      let dynamic = dynamics[d]
      output.buffer += statics[0]
      for(let i = 1; i < statics.length; i++){
        this.dynamicToBuffer(dynamic[i - 1], output)
        output.buffer += statics[i]
      }
    }
  }

  dynamicToBuffer(rendered, output){
    if(typeof(rendered) === "number"){
      output.buffer += this.recursiveCIDToString(output.components, rendered, output.onlyCids)
   } else if(isObject(rendered)){
      this.toOutputBuffer(rendered, output)
    } else {
      output.buffer += rendered
    }
  }

  recursiveCIDToString(components, cid, onlyCids){
    let component = components[cid] || logError(`no component for CID ${cid}`, components)
    let template = document.createElement("template")
    template.innerHTML = this.recursiveToString(component, components, onlyCids)
    let container = template.content
    let skip = onlyCids && !onlyCids.has(cid)
    Array.from(container.childNodes).forEach((child, i) => {
      if(child.nodeType === Node.ELEMENT_NODE){
        child.setAttribute(PHX_COMPONENT, cid)
        if(!child.id){ child.id = `${this.parentViewId()}-${cid}-${i}`}
        if(skip){
          child.setAttribute(PHX_SKIP, "")
          child.innerHTML = ""
        }
      } else {
        if(child.nodeValue.trim() !== ""){
          logError(`only HTML element tags are allowed at the root of components.\n\n` +
                   `got: "${child.nodeValue.trim()}"\n\n` +
                   `within:\n`, template.innerHTML.trim())

          let span = document.createElement("span")
          span.innerText = child.nodeValue
          span.setAttribute(PHX_COMPONENT, cid)
          child.replaceWith(span)
        } else {
          child.remove()
        }
      }
    })

    return template.innerHTML
  }
}

/** Initializes the LiveSocket
 *
 *
 * @param {string} endPoint - The string WebSocket endpoint, ie, `"wss://example.com/live"`,
 *                                               `"/live"` (inherited host & protocol)
 * @param {Phoenix.Socket} socket - the required Phoenix Socket class imported from "phoenix". For example:
 *
 *     import {Socket} from "phoenix"
 *     import {LiveSocket} from "phoenix_live_view"
 *     let liveSocket = new LiveSocket("/live", Socket, {...})
 *
 * @param {Object} [opts] - Optional configuration. Outside of keys listed below, all
 * configuration is passed directly to the Phoenix Socket constructor.
 * @param {Object} [opts.defaults] - The optional defaults to use for various bindings,
 * such as `phx-debounce`. Supports the following keys:
 *
 *   - debounce - the millisecond phx-debounce time. Defaults 300
 *   - throttle - the millisecond phx-throttle time. Defaults 300
 *
 * @param {Function} [opts.params] - The optional function for passing connect params.
 * The function receives the viewName associated with a given LiveView. For example:
 *
 *     (viewName) => {view: viewName, token: window.myToken}
 *
 * @param {string} [opts.bindingPrefix] - The optional prefix to use for all phx DOM annotations.
 * Defaults to "phx-".
 * @param {Object} [opts.hooks] - The optional object for referencing LiveView hook callbacks.
 * @param {integer} [opts.loaderTimeout] - The optional delay in milliseconds to wait before apply
 * loading states.
 * @param {Function} [opts.viewLogger] - The optional function to log debug information. For example:
 *
 *     (view, kind, msg, obj) => console.log(`${view.id} ${kind}: ${msg} - `, obj)
 *
 * @param {Object} [opts.metadata] - The optional object mapping event names to functions for
 * populating event metadata. For example:
 *
 *     metadata: {
 *       click: (e, el) => {
 *         return {
 *           ctrlKey: e.ctrlKey,
 *           metaKey: e.metaKey,
 *           detail: e.detail || 1,
 *         }
 *       },
 *       keydown: (e, el) => {
 *         return {
 *           key: e.key,
 *           ctrlKey: e.ctrlKey,
 *           metaKey: e.metaKey,
 *           shiftKey: e.shiftKey
 *         }
 *       }
 *     }
*/
export class LiveSocket {
  constructor(url, phxSocket, opts = {}){
    this.unloaded = false
    if(!phxSocket || phxSocket.constructor.name === "Object"){
      throw new Error(`
      a phoenix Socket must be provided as the second argument to the LiveSocket constructor. For example:

          import {Socket} from "phoenix"
          import {LiveSocket} from "phoenix_live_view"
          let liveSocket = new LiveSocket("/live", Socket, {...})
      `)
    }
    this.socket = new phxSocket(url, opts)
    this.bindingPrefix = opts.bindingPrefix || BINDING_PREFIX
    this.opts = opts
    this.params = closure(opts.params || {})
    this.viewLogger = opts.viewLogger
    this.metadataCallbacks = opts.metadata || {}
    this.defaults = Object.assign(clone(DEFAULTS), opts.defaults || {})
    this.activeElement = null
    this.prevActive = null
    this.silenced = false
    this.main = null
    this.linkRef = 0
    this.roots = {}
    this.href = window.location.href
    this.pendingLink = null
    this.currentLocation = clone(window.location)
    this.hooks = opts.hooks || {}
    this.loaderTimeout = opts.loaderTimeout || LOADER_TIMEOUT
    this.boundTopLevelEvents = false
    window.addEventListener("unload", e => {
      this.unloaded = true
    })
    this.socket.onOpen(() => {
      if(this.isUnloaded()){
        // reload page if being restored from back/forward cache and browser does not emit "pageshow"
        window.location.reload()
      }
    })
  }

  // public

  isProfileEnabled(){ return sessionStorage.getItem(PHX_LV_PROFILE) === "true" }

  isDebugEnabled(){ return sessionStorage.getItem(PHX_LV_DEBUG) === "true" }

  enableDebug(){ sessionStorage.setItem(PHX_LV_DEBUG, "true") }

  enableProfiling(){ sessionStorage.setItem(PHX_LV_PROFILE, "true") }

  disableDebug(){ sessionStorage.removeItem(PHX_LV_DEBUG) }

  disableProfiling(){ sessionStorage.removeItem(PHX_LV_PROFILE) }

  enableLatencySim(upperBoundMs){
    this.enableDebug()
    console.log("latency simulator enabled for the duration of this browser session. Call disableLatencySim() to disable")
    sessionStorage.setItem(PHX_LV_LATENCY_SIM, upperBoundMs)
  }

  disableLatencySim(){ sessionStorage.removeItem(PHX_LV_LATENCY_SIM) }

  getLatencySim(){
    let str = sessionStorage.getItem(PHX_LV_LATENCY_SIM)
    return str ? parseInt(str) : null
  }

  getSocket(){ return this.socket }

  connect(){
    let doConnect = () => {
      if(this.joinRootViews()){
        this.bindTopLevelEvents()
        this.socket.connect()
      }
    }
    if(["complete", "loaded","interactive"].indexOf(document.readyState) >= 0){
      doConnect()
    } else {
      document.addEventListener("DOMContentLoaded", () => doConnect())
    }
  }

  disconnect(callback){ this.socket.disconnect(callback) }

  // private

  time(name, func){
    if(!this.isProfileEnabled() || !console.time){ return func() }
    console.time(name)
    let result = func()
    console.timeEnd(name)
    return result
  }

  log(view, kind, msgCallback){
    if(this.viewLogger){
      let [msg, obj] = msgCallback()
      this.viewLogger(view, kind, msg, obj)
    } else if(this.isDebugEnabled()){
      let [msg, obj] = msgCallback()
      debug(view, kind, msg, obj)
    }
  }

  onChannel(channel, event, cb){
    channel.on(event, data => {
      let latency = this.getLatencySim()
      if(!latency){
        cb(data)
      } else {
        console.log(`simulating ${latency}ms of latency from server to client`)
        setTimeout(() => cb(data), latency)
      }
    })
  }

  wrapPush(push){
    let latency = this.getLatencySim()
    if(!latency){ return push() }

    console.log(`simulating ${latency}ms of latency from client to server`)
    let fakePush = {
      receives: [],
      receive(kind, cb){ this.receives.push([kind, cb])}
    }
    setTimeout(() => {
      fakePush.receives.reduce((acc, [kind, cb]) => acc.receive(kind, cb), push())
    }, latency)
    return fakePush
  }

  reloadWithJitter(view){
    this.disconnect()
    let [minMs, maxMs] = RELOAD_JITTER
    let afterMs = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs
    let tries = Browser.updateLocal(view.name(), CONSECUTIVE_RELOADS, 0, count => count + 1)
    this.log(view, "join", () => [`encountered ${tries} consecutive reloads`])
    if(tries > MAX_RELOADS){
      this.log(view, "join", () => [`exceeded ${MAX_RELOADS} consecutive reloads. Entering failsafe mode`])
      afterMs = FAILSAFE_JITTER
    }
    setTimeout(() => {
      if(this.hasPendingLink()){
        window.location = this.pendingLink
      } else {
        window.location.reload()
      }
    }, afterMs)
  }

  getHookCallbacks(hookName){ return this.hooks[hookName] }

  isUnloaded(){ return this.unloaded }

  isConnected(){ return this.socket.isConnected() }

  getBindingPrefix(){ return this.bindingPrefix }

  binding(kind){ return `${this.getBindingPrefix()}${kind}` }

  channel(topic, params){ return this.socket.channel(topic, params) }

  joinRootViews(){
    let rootsFound = false
    DOM.all(document, `${PHX_VIEW_SELECTOR}:not([${PHX_PARENT_ID}])`, rootEl => {
      let view = this.joinRootView(rootEl, this.getHref())
      this.root = this.root || view
      if(rootEl.getAttribute(PHX_MAIN)){ this.main = view }
      rootsFound = true
    })
    return rootsFound
  }

  redirect(to, flash){
    this.disconnect()
    Browser.redirect(to, flash)
  }

  replaceMain(href, flash, callback = null, linkRef = this.setPendingLink(href)){
    let mainEl = this.main.el
    this.main.showLoader(this.loaderTimeout)
    this.main.destroy()

    Browser.fetchPage(href, (status, html) => {
      if(status !== 200){ return this.redirect(href) }

      let template = document.createElement("template")
      template.innerHTML = html
      let el = template.content.childNodes[0]
      if(!el || !this.isPhxView(el)){ return this.redirect(href) }

      this.joinRootView(el, href, flash, (newMain, joinCount) => {
        if(joinCount !== 1){ return }
        if(!this.commitPendingLink(linkRef)){
          newMain.destroy()
          return
        }
        mainEl.replaceWith(newMain.el)
        this.main = newMain
        callback && callback()
      })
    })
  }

  isPhxView(el){ return el.getAttribute && el.getAttribute(PHX_VIEW) !== null }

  joinRootView(el, href, flash, callback){
    let view = new View(el, this, null, href, flash)
    this.roots[view.id] = view
    view.join(callback)
    return view
  }

  owner(childEl, callback){
    let view = maybe(childEl.closest(PHX_VIEW_SELECTOR), el => this.getViewByEl(el))
    if(view){ callback(view) }
  }

  withinTargets(el, phxTarget, callback){
    if(/^(0|[1-9](\d?)+)$/.test(phxTarget)){
      let myselfTarget = el || DOM.findFirstComponentNode(document, phxTarget)
      if(!myselfTarget){ throw new Error(`no phx-target's found matching @myself of ${phxTarget}`) }
      this.owner(myselfTarget , view => callback(view, myselfTarget))
    } else {
      let targets = Array.from(document.querySelectorAll(phxTarget))
      if(targets.length === 0){ throw new Error(`no phx-target's found for selector "${phxTarget}"`) }
      targets.forEach(targetEl => {
        this.owner(targetEl, view => callback(view, targetEl))
      })
    }
  }

  withinOwners(childEl, callback){
    let phxTarget = childEl.getAttribute(this.binding("target"))
    if(phxTarget === null){
      this.owner(childEl, view => callback(view, childEl))
    } else {
      this.withinTargets(childEl, phxTarget, callback)
    }
  }

  getViewByEl(el){
    let rootId = el.getAttribute(PHX_ROOT_ID)
    return this.getRootById(rootId).getDescendentByEl(el)
  }

  getRootById(id){ return this.roots[id] }

  onViewError(view){
    this.dropActiveElement(view)
  }

  destroyAllViews(){
    for(let id in this.roots){
      this.roots[id].destroy()
      delete this.roots[id]
    }
  }

  destroyViewByEl(el){
    let root = this.getRootById(el.getAttribute(PHX_ROOT_ID))
    root.destroyDescendent(el.id)
  }

  setActiveElement(target){
    if(this.activeElement === target){ return }
    this.activeElement = target
    let cancel = () => {
      if(target === this.activeElement){ this.activeElement = null }
      target.removeEventListener("mouseup", this)
      target.removeEventListener("touchend", this)
    }
    target.addEventListener("mouseup", cancel)
    target.addEventListener("touchend", cancel)
  }

  getActiveElement(){
    if(document.activeElement === document.body){
      return this.activeElement || document.activeElement
    } else {
      return document.activeElement
    }
  }

  dropActiveElement(view){
    if(this.prevActive && view.ownsElement(this.prevActive)){
      this.prevActive = null
    }
  }

  restorePreviouslyActiveFocus(){
    if(this.prevActive && this.prevActive !== document.body){
      this.prevActive.focus()
    }
  }

  blurActiveElement(){
    this.prevActive = this.getActiveElement()
    if(this.prevActive !== document.body){ this.prevActive.blur() }
  }

  bindTopLevelEvents(){
    if(this.boundTopLevelEvents){ return }
    this.boundTopLevelEvents = true
    window.addEventListener("pageshow", e => {
      if(e.persisted){ // reload page if being restored from back/forward cache
        this.withPageLoading({to: window.location.href, kind: "redirect"})
        window.location.reload()
      }
    })
    this.bindClicks()
    this.bindNav()
    this.bindForms()
    this.bind({keyup: "keyup", keydown: "keydown"}, (e, type, view, target, targetCtx, phxEvent, phxTarget) => {
      let matchKey = target.getAttribute(this.binding(PHX_KEY))
      let pressedKey = e.key && e.key.toLowerCase() // chrome clicked autocompletes send a keydown without key
      if(matchKey && matchKey.toLowerCase() !== pressedKey){ return }

      view.pushKey(target, targetCtx, type, phxEvent, {key: e.key, ...this.eventMeta(type, e, target)})
    })
    this.bind({blur: "focusout", focus: "focusin"}, (e, type, view, targetEl, targetCtx, phxEvent, phxTarget) => {
      if(!phxTarget){
        view.pushEvent(type, targetEl, targetCtx, phxEvent, this.eventMeta(type, e, targetEl))
      }
    })
    this.bind({blur: "blur", focus: "focus"}, (e, type, view, targetEl, targetCtx, phxEvent, phxTarget) => {
      // blur and focus are triggered on document and window. Discard one to avoid dups
      if(phxTarget && !phxTarget !== "window"){
        view.pushEvent(type, targetEl, targetCtx, phxEvent, this.eventMeta(type, e, targetEl))
      }
    })
  }

  eventMeta(eventName, e, targetEl){
    let callback = this.metadataCallbacks[eventName]
    return callback ? callback(e, targetEl) : {}
  }

  setPendingLink(href){
    this.linkRef++
    this.pendingLink = href
    return this.linkRef
  }

  commitPendingLink(linkRef){
    if(this.linkRef !== linkRef){
      return false
    } else {
      this.href = this.pendingLink
      this.pendingLink = null
      return true
    }
  }

  getHref(){ return this.href }

  hasPendingLink(){ return !!this.pendingLink }

  bind(events, callback){
    for(let event in events){
      let browserEventName = events[event]

      this.on(browserEventName, e => {
        let binding = this.binding(event)
        let windowBinding = this.binding(`window-${event}`)
        let targetPhxEvent = e.target.getAttribute && e.target.getAttribute(binding)
        if(targetPhxEvent){
          this.debounce(e.target, e, () => {
            this.withinOwners(e.target, (view, targetCtx) => {
              callback(e, event, view, e.target, targetCtx, targetPhxEvent, null)
            })
          })
        } else {
          DOM.all(document, `[${windowBinding}]`, el => {
            let phxEvent = el.getAttribute(windowBinding)
            this.debounce(el, e, () => {
              this.withinOwners(el, (view, targetCtx) => {
                callback(e, event, view, el, targetCtx, phxEvent, "window")
              })
            })
          })
        }
      })
    }
  }

  bindClicks(){
    [true, false].forEach(capture => {
      let click = capture ? this.binding("capture-click") : this.binding("click")
      window.addEventListener("click", e => {
        let target = null
        if(capture){
          target = e.target.matches(`[${click}]`) ? e.target : e.target.querySelector(`[${click}]`)
        } else {
          target = closestPhxBinding(e.target, click)
        }
        let phxEvent = target && target.getAttribute(click)
        if(!phxEvent){ return }
        if(target.getAttribute("href") === "#"){ e.preventDefault() }

        this.debounce(target, e, () => {
          this.withinOwners(target, (view, targetCtx) => {
            view.pushEvent("click", target, targetCtx, phxEvent, this.eventMeta("click", e, target))
          })
        })
      }, capture)
    })
  }

  bindNav(){
    if(!Browser.canPushState()){ return }
    window.onpopstate = (event) => {
      if(!this.registerNewLocation(window.location)){ return }
      let {type, id, root} = event.state || {}
      let href = window.location.href

      if(this.main.isConnected() && (type === "patch" && id  === this.main.id)){
        this.main.pushLinkPatch(href, null)
      } else {
        this.replaceMain(href, null, () => {
          if(root){ this.replaceRootHistory() }
        })
      }
    }
    window.addEventListener("click", e => {
      let target = closestPhxBinding(e.target, PHX_LIVE_LINK)
      let type = target && target.getAttribute(PHX_LIVE_LINK)
      let wantsNewTab = e.metaKey || e.ctrlKey || e.button === 1
      if(!type || !this.isConnected() || !this.main || wantsNewTab){ return }
      let href = target.href
      let linkState = target.getAttribute(PHX_LINK_STATE)
      e.preventDefault()
      if(this.pendingLink === href){ return }

      if(type === "patch"){
        this.pushHistoryPatch(href, linkState, target)
      } else if(type === "redirect") {
        this.historyRedirect(href, linkState)
      } else {
        throw new Error(`expected ${PHX_LIVE_LINK} to be "patch" or "redirect", got: ${type}`)
      }
    }, false)
  }

  withPageLoading(info, callback){
    DOM.dispatchEvent(window, "phx:page-loading-start", info)
    let done = () => DOM.dispatchEvent(window, "phx:page-loading-stop", info)
    return callback ? callback(done) : done
  }

  pushHistoryPatch(href, linkState, targetEl){
    this.withPageLoading({to: href, kind: "patch"}, done => {
      this.main.pushLinkPatch(href, targetEl, () => {
        this.historyPatch(href, linkState)
        done()
      })
    })
  }

  historyPatch(href, linkState){
    Browser.pushState(linkState, {type: "patch", id: this.main.id}, href)
    this.registerNewLocation(window.location)
  }

  historyRedirect(href, linkState, flash){
    this.withPageLoading({to: href, kind: "redirect"}, done => {
      this.replaceMain(href, flash, () => {
        Browser.pushState(linkState, {type: "redirect", id: this.main.id}, href)
        this.registerNewLocation(window.location)
        done()
      })
    })
  }

  replaceRootHistory(){
    Browser.pushState("replace", {root: true, type: "patch", id: this.main.id})
  }

  registerNewLocation(newLocation){
    let {pathname, search} = this.currentLocation
    if(pathname + search === newLocation.pathname + newLocation.search){
      return false
    } else {
      this.currentLocation = clone(newLocation)
      return true
    }
  }

  bindForms(){
    let iterations = 0
    this.on("submit", e => {
      let phxEvent = e.target.getAttribute(this.binding("submit"))
      if(!phxEvent){ return }
      e.preventDefault()
      e.target.disabled = true
      this.withinOwners(e.target, (view, targetCtx) => view.submitForm(e.target, targetCtx, phxEvent))
    }, false)

    for(let type of ["change", "input"]){
      this.on(type, e => {
        let input = e.target
        let phxEvent = input.form && input.form.getAttribute(this.binding("change"))
        if(!phxEvent){ return }
        if(input.type === "number" && input.validity && input.validity.badInput){ return }
        let currentIterations = iterations
        iterations++
        let {at: at, type: lastType} = DOM.private(input, "prev-iteration") || {}
        // detect dup because some browsers dispatch both "input" and "change"
        if(at === currentIterations - 1 && type !== lastType){ return }

        DOM.putPrivate(input, "prev-iteration", {at: currentIterations, type: type})

        this.debounce(input, e, () => {
          this.withinOwners(input.form, (view, targetCtx) => {
            if(DOM.isTextualInput(input)){
              DOM.putPrivate(input, PHX_HAS_FOCUSED, true)
            } else {
              this.setActiveElement(input)
            }
            view.pushInput(input, targetCtx, phxEvent, e.target)
          })
        })
      }, false)
    }
  }

  debounce(el, event, callback){
    let phxDebounce = this.binding(PHX_DEBOUNCE)
    let phxThrottle = this.binding(PHX_THROTTLE)
    let defaultDebounce = this.defaults.debounce.toString()
    let defaultThrottle = this.defaults.throttle.toString()
    DOM.debounce(el, event, phxDebounce, defaultDebounce, phxThrottle, defaultThrottle, callback)
  }

  silenceEvents(callback){
    this.silenced = true
    callback()
    this.silenced = false
  }

  on(event, callback){
    window.addEventListener(event, e => {
      if(!this.silenced){ callback(e) }
    })
  }
}

export let Browser = {
  canPushState(){ return (typeof(history.pushState) !== "undefined") },

  dropLocal(namespace, subkey){
    return window.localStorage.removeItem(this.localKey(namespace, subkey))
  },

  updateLocal(namespace, subkey, initial, func){
    let current = this.getLocal(namespace, subkey)
    let key = this.localKey(namespace, subkey)
    let newVal = current === null ? initial : func(current)
    window.localStorage.setItem(key, JSON.stringify(newVal))
    return newVal
  },

  getLocal(namespace, subkey){
    return JSON.parse(window.localStorage.getItem(this.localKey(namespace, subkey)))
  },

  fetchPage(href, callback){
    let req = new XMLHttpRequest()
    req.open("GET", href, true)
    req.timeout = PUSH_TIMEOUT
    req.setRequestHeader("content-type", "text/html")
    req.setRequestHeader("cache-control", "max-age=0, no-cache, no-store, must-revalidate, post-check=0, pre-check=0")
    req.setRequestHeader(LINK_HEADER, "live-link")
    req.onerror = () => callback(400)
    req.ontimeout = () => callback(504)
    req.onreadystatechange = () => {
      if(req.readyState !== 4){ return }
      let requestURL = new URL(href)
      let requestPath = requestURL.pathname + requestURL.search
      let responseURL = new URL(req.getResponseHeader(RESPONSE_URL_HEADER))
      let responsePath = responseURL.pathname + responseURL.search
      if(req.getResponseHeader(LINK_HEADER) !== "live-link"){
        return callback(400)
      } else if(responsePath != requestPath){
        return callback(302)
      } else if(req.status !== 200){
        return callback(req.status)
      } else {
        callback(200, req.responseText)
      }
    }
    req.send()
  },

  pushState(kind, meta, to){
    if(this.canPushState()){
      if(to !== window.location.href){
        history[kind + "State"](meta, "", to || null) // IE will coerce undefined to string
        let hashEl = this.getHashTargetEl(window.location.hash)

        if(hashEl) {
          hashEl.scrollIntoView()
        } else if(meta.type === "redirect"){
          window.scroll(0, 0)
        }
      }
    } else {
      this.redirect(to)
    }
  },

  setCookie(name, value){
    document.cookie = `${name}=${value}`
  },

  getCookie(name){
    return document.cookie.replace(new RegExp(`(?:(?:^|.*;\s*)${name}\s*\=\s*([^;]*).*$)|^.*$`), "$1")
  },

  redirect(toURL, flash){
    if(flash){ Browser.setCookie("__phoenix_flash__", flash + "; max-age=60000; path=/") }
    window.location = toURL
  },

  localKey(namespace, subkey){ return `${namespace}-${subkey}` },

  getHashTargetEl(hash){
    if(hash.toString() === ""){ return }
    return document.getElementById(hash) || document.querySelector(`a[name="${hash.substring(1)}"]`)
  }
}

export let DOM = {
  byId(id){ return document.getElementById(id) || logError(`no id found for ${id}`) },

  removeClass(el, className){
    el.classList.remove(className)
    if(el.classList.length === 0){ el.removeAttribute("class") }
  },

  all(node, query, callback){
    let array = Array.from(node.querySelectorAll(query))
    return callback ? array.forEach(callback) : array
  },

  findFirstComponentNode(node, cid){ return node.querySelector(`[${PHX_COMPONENT}="${cid}"]`) },

  findComponentNodeList(node, cid){ return this.all(node, `[${PHX_COMPONENT}="${cid}"]`) },

  findPhxChildrenInFragment(html, parentId){
    let template = document.createElement("template")
    template.innerHTML = html
    return this.findPhxChildren(template.content, parentId)
  },

  isPhxUpdate(el, phxUpdate, updateTypes){
    return el.getAttribute && updateTypes.indexOf(el.getAttribute(phxUpdate)) >= 0
  },

  findPhxChildren(el, parentId){
    return this.all(el, `${PHX_VIEW_SELECTOR}[${PHX_PARENT_ID}="${parentId}"]`)
  },

  findParentCIDs(node, cids){
    let initial = new Set(cids)
    return cids.reduce((acc, cid) => {
      let selector = `[${PHX_COMPONENT}="${cid}"] [${PHX_COMPONENT}]`
      this.all(node, selector)
        .map(el => parseInt(el.getAttribute(PHX_COMPONENT)))
        .forEach(childCID => acc.delete(childCID))

      return acc
    }, initial)
  },

  private(el, key){ return el[PHX_PRIVATE] && el[PHX_PRIVATE][key] },

  deletePrivate(el, key){ el[PHX_PRIVATE] && delete(el[PHX_PRIVATE][key]) },

  putPrivate(el, key, value){
    if(!el[PHX_PRIVATE]){ el[PHX_PRIVATE] = {} }
    el[PHX_PRIVATE][key] = value
  },

  copyPrivates(target, source){
    if(source[PHX_PRIVATE]){
      target[PHX_PRIVATE] = clone(source[PHX_PRIVATE])
    }
  },

  putTitle(str){
    let titleEl = document.querySelector("title")
    let {prefix, suffix} = titleEl.dataset
    document.title = `${prefix || ""}${str}${suffix || ""}`
  },

  debounce(el, event, phxDebounce, defaultDebounce, phxThrottle, defaultThrottle, callback){
    let debounce = el.getAttribute(phxDebounce)
    let throttle = el.getAttribute(phxThrottle)
    if(debounce === ""){ debounce = defaultDebounce }
    if(throttle === ""){ throttle = defaultThrottle }
    let value = debounce || throttle
    switch(value){
      case null: return callback()

      case "blur":
        if(this.private(el, DEBOUNCE_BLUR)){ return }
        el.addEventListener("blur", () => callback())
        this.putPrivate(el, DEBOUNCE_BLUR, value)
        return

      default:
        let timeout = parseInt(value)
        if(isNaN(timeout)){ return logError(`invalid throttle/debounce value: ${value}`) }
        if(throttle && event.type === "keydown"){
          let prevKey = this.private(el, DEBOUNCE_PREV_KEY)
          this.putPrivate(el, DEBOUNCE_PREV_KEY, event.which)
          if(prevKey !== event.which){ return callback() }
        }
        if(this.private(el, DEBOUNCE_TIMER)){ return }

        let clearTimer = (e) => {
          if(throttle && e.type === PHX_CHANGE_EVENT && e.detail.triggeredBy.name === el.name){ return }
          clearTimeout(this.private(el, DEBOUNCE_TIMER))
          this.deletePrivate(el, DEBOUNCE_TIMER)
        }
        let debounceCallback = () => {
          if(el.form){
            el.form.removeEventListener(PHX_CHANGE_EVENT, clearTimer)
            el.form.removeEventListener("submit", clearTimer)
          }
          el.removeEventListener("blur", this.private(el, DEBOUNCE_BLUR_TIMER))
          if (!throttle) {
            el.removeEventListener("keydown", clearTimer)
          }
          this.deletePrivate(el, DEBOUNCE_BLUR_TIMER)
          this.deletePrivate(el, DEBOUNCE_TIMER)
          if(!throttle){ callback() }
        }
        let blurCallback = () => {
          clearTimeout(this.private(el, DEBOUNCE_TIMER))
          debounceCallback()
        }
        this.putPrivate(el, DEBOUNCE_TIMER, setTimeout(debounceCallback, timeout))
        el.addEventListener("blur", blurCallback)
        if (!throttle) {
          el.addEventListener("keydown", clearTimer)
        }
        this.putPrivate(el, DEBOUNCE_BLUR_TIMER, blurCallback)
        if(el.form){
          el.form.addEventListener(PHX_CHANGE_EVENT, clearTimer)
          el.form.addEventListener("submit", clearTimer)
        }
        if(throttle){ callback() }
    }
  },

  discardError(container, el, phxFeedbackFor){
    let field = el.getAttribute && el.getAttribute(phxFeedbackFor)
    let input = field && container.querySelector(`#${field}`)
    if(!input){ return }

    if(!(this.private(input, PHX_HAS_FOCUSED) || this.private(input.form, PHX_HAS_SUBMITTED))){
      el.classList.add(PHX_NO_FEEDBACK_CLASS)
    }
  },

  isPhxChild(node){
    return node.getAttribute && node.getAttribute(PHX_PARENT_ID)
  },

  dispatchEvent(target, eventString, detail = {}){
    let event = new CustomEvent(eventString, {bubbles: true, cancelable: true, detail: detail})
    target.dispatchEvent(event)
  },

  cloneNode(node, html){
    if(typeof(html) === "undefined"){
      return node.cloneNode(true)
    } else {
      let cloned = node.cloneNode(false)
      cloned.innerHTML = html
      return cloned
    }
  },

  mergeAttrs(target, source, exclude = []){
    let sourceAttrs = source.attributes
    for (let i = sourceAttrs.length - 1; i >= 0; i--){
      let name = sourceAttrs[i].name
      if(exclude.indexOf(name) < 0){ target.setAttribute(name, source.getAttribute(name)) }
    }

    let targetAttrs = target.attributes
    for (let i = targetAttrs.length - 1; i >= 0; i--){
      let name = targetAttrs[i].name
      if(!source.hasAttribute(name)){ target.removeAttribute(name) }
    }
  },

  mergeFocusedInput(target, source){
    // skip selects because FF will reset highlighted index for any setAttribute
    if(!(target instanceof HTMLSelectElement)){ DOM.mergeAttrs(target, source, ["value"]) }
    if(source.readOnly){
      target.setAttribute("readonly", true)
    } else {
      target.removeAttribute("readonly")
    }
  },

  restoreFocus(focused, selectionStart, selectionEnd){
    if(!DOM.isTextualInput(focused)){ return }
    let wasFocused = focused.matches(":focus")
    if(focused.readOnly){ focused.blur() }
    if(!wasFocused){ focused.focus() }
    if(focused.setSelectionRange && focused.type === "text" || focused.type === "textarea"){
      focused.setSelectionRange(selectionStart, selectionEnd)
    }
  },

  isFormInput(el){ return /^(?:input|select|textarea)$/i.test(el.tagName) },

  syncAttrsToProps(el){
    if(el instanceof HTMLInputElement && CHECKABLE_INPUTS.indexOf(el.type.toLocaleLowerCase()) >= 0){
      el.checked = el.getAttribute("checked") !== null
    }
  },

  isTextualInput(el){ return FOCUSABLE_INPUTS.indexOf(el.type) >= 0 },

  isNowTriggerFormExternal(el, phxTriggerExternal){
    return el.getAttribute && el.getAttribute(phxTriggerExternal) !== null
  },

  undoRefs(ref, container){
    DOM.all(container, `[${PHX_REF}]`, el => this.syncPendingRef(ref, el, el))
  },

  syncPendingRef(ref, fromEl, toEl){
    let fromRefAttr = fromEl.getAttribute && fromEl.getAttribute(PHX_REF)
    if(fromRefAttr === null){ return true }

    let fromRef = parseInt(fromRefAttr)
    if(ref !== null && ref >= fromRef){
      [fromEl, toEl].forEach(el => {
        // remove refs
        el.removeAttribute(PHX_REF)
        // retore inputs
        if(el.getAttribute(PHX_READONLY) !== null){
          el.readOnly = false
          el.removeAttribute(PHX_READONLY)
        }
        if(el.getAttribute(PHX_DISABLED) !== null){
          el.disabled = false
          el.removeAttribute(PHX_DISABLED)
        }
        // remove classes
        PHX_EVENT_CLASSES.forEach(className => DOM.removeClass(el, className))
        // restore disables
        let disableRestore = el.getAttribute(PHX_DISABLE_WITH_RESTORE)
        if(disableRestore !== null){
          el.innerText = disableRestore
          el.removeAttribute(PHX_DISABLE_WITH_RESTORE)
        }
      })
      return true
    } else {
      PHX_EVENT_CLASSES.forEach(className => {
        fromEl.classList.contains(className) && toEl.classList.add(className)
      })
      toEl.setAttribute(PHX_REF, fromEl.getAttribute(PHX_REF))
      if(DOM.isFormInput(fromEl) || /submit/i.test(fromEl.type)){
        return false
      } else {
        return true
      }
    }
  }
}

class DOMPatch {
  constructor(view, container, id, html, targetCID, ref){
    this.view = view
    this.liveSocket = view.liveSocket
    this.container = container
    this.id = id
    this.rootID = view.root.id
    this.html = html
    this.targetCID = targetCID
    this.ref = ref
    this.cidPatch = typeof(this.targetCID) === "number"
    this.callbacks = {
      beforeadded: [], beforeupdated: [], beforediscarded: [], beforephxChildAdded: [],
      afteradded: [], afterupdated: [], afterdiscarded: [], afterphxChildAdded: []
    }
  }

  before(kind, callback){ this.callbacks[`before${kind}`].push(callback) }
  after(kind, callback){ this.callbacks[`after${kind}`].push(callback) }

  trackBefore(kind, ...args){
    this.callbacks[`before${kind}`].forEach(callback => callback(...args))
  }

  trackAfter(kind, ...args){
    this.callbacks[`after${kind}`].forEach(callback => callback(...args))
  }

  markPrunableContentForRemoval(){
    DOM.all(this.container, `[phx-update=append] > *, [phx-update=prepend] > *`, el => {
      el.setAttribute(PHX_REMOVE, "")
    })
  }

  perform(){
    let {view, liveSocket, container, html} = this
    let targetContainer = this.isCIDPatch() ? this.targetCIDContainer() : container
    if(this.isCIDPatch() && !targetContainer){ return }

    let focused = liveSocket.getActiveElement()
    let {selectionStart, selectionEnd} = focused && DOM.isTextualInput(focused) ? focused : {}
    let phxUpdate = liveSocket.binding(PHX_UPDATE)
    let phxFeedbackFor = liveSocket.binding(PHX_FEEDBACK_FOR)
    let phxTriggerExternal = liveSocket.binding(PHX_TRIGGER_ACTION)
    let added = []
    let updates = []
    let appendPrependUpdates = []

    let diffHTML = liveSocket.time("premorph container prep", () => {
      return this.buildDiffHTML(container, html, phxUpdate, targetContainer)
    })

    this.trackBefore("added", container)
    this.trackBefore("updated", container, container)

    liveSocket.time("morphdom", () => {
      morphdom(targetContainer, diffHTML, {
        childrenOnly: targetContainer.getAttribute(PHX_COMPONENT) === null,
        onBeforeNodeAdded: (el) => {
          //input handling
          DOM.discardError(targetContainer, el, phxFeedbackFor)
          this.trackBefore("added", el)
          return el
        },
        onNodeAdded: (el) => {
          if(DOM.isNowTriggerFormExternal(el, phxTriggerExternal)){ el.submit() }
          // nested view handling
          if(DOM.isPhxChild(el) && view.ownsElement(el)){
            this.trackAfter("phxChildAdded", el)
          }
          added.push(el)
        },
        onNodeDiscarded: (el) => { this.trackAfter("discarded", el) },
        onBeforeNodeDiscarded: (el) => {
          if(el.getAttribute && el.getAttribute(PHX_REMOVE) !== null){ return true }
          if(el.parentNode !== null && DOM.isPhxUpdate(el.parentNode, phxUpdate, ["append", "prepend"])){ return false }
          if(this.skipCIDSibling(el)){ return false }
          this.trackBefore("discarded", el)
          // nested view handling
          if(DOM.isPhxChild(el)){
            liveSocket.destroyViewByEl(el)
            return true
          }
        },
        onElUpdated: (el) => {
          if(DOM.isNowTriggerFormExternal(el, phxTriggerExternal)){ el.submit() }
          updates.push(el)
        },
        onBeforeElUpdated: (fromEl, toEl) => {
          if(this.skipCIDSibling(toEl)){ return false }
          if(fromEl.getAttribute(phxUpdate) === "ignore"){
            this.trackBefore("updated", fromEl, toEl)
            DOM.mergeAttrs(fromEl, toEl)
            updates.push(fromEl)
            return false
          }
          if(fromEl.type === "number" && (fromEl.validity && fromEl.validity.badInput)){ return false }
          if(!DOM.syncPendingRef(this.ref, fromEl, toEl)){ return false }

          // nested view handling
          if(DOM.isPhxChild(toEl)){
            let prevStatic = fromEl.getAttribute(PHX_STATIC)
            DOM.mergeAttrs(fromEl, toEl)
            fromEl.setAttribute(PHX_STATIC, prevStatic)
            fromEl.setAttribute(PHX_ROOT_ID, this.rootID)
            return false
          }

          // input handling
          DOM.copyPrivates(toEl, fromEl)
          DOM.discardError(targetContainer, toEl, phxFeedbackFor)

          let isFocusedFormEl = focused && fromEl.isSameNode(focused) && DOM.isFormInput(fromEl)
          if(isFocusedFormEl && !this.forceFocusedSelectUpdate(fromEl, toEl)){
            this.trackBefore("updated", fromEl, toEl)
            DOM.mergeFocusedInput(fromEl, toEl)
            DOM.syncAttrsToProps(fromEl)
            updates.push(fromEl)
            return false
          } else {
            // we optimize append/prepend operations in two ways:
            //   1) By tracking the previously appended ids. If the ids don't
            //     change b/w patches, we know that we are going to re-arrange
            //     the same appendPrependUpdates so we can skip the post-morph
            //     append/prepend ops.
            //   2) for appends, we can skip post-morph re-arranging if the
            //     new content contains only new ids, because it will simply
            //     be appended to the container
            if(DOM.isPhxUpdate(toEl, phxUpdate, ["append", "prepend"])){
              let isAppend = toEl.getAttribute(phxUpdate) === "append"
              let idsBefore = Array.from(fromEl.children).map(child => child.id)
              let newIds = Array.from(toEl.children).map(child => child.id)
              let isOnlyNewIds = isAppend && !newIds.find(id => idsBefore.indexOf(id) >= 0)

              if(!isOnlyNewIds){
                appendPrependUpdates.push([toEl.id, idsBefore])
              }
            }
            DOM.syncAttrsToProps(toEl)
            this.trackBefore("updated", fromEl, toEl)
            return true
          }
        }
      })
    })

    if(liveSocket.isDebugEnabled()){ detectDuplicateIds() }

    if(appendPrependUpdates.length > 0){
      liveSocket.time("post-morph append/prepend restoration", () => {
        appendPrependUpdates.forEach(([containerID, idsBefore]) => {
          let el = DOM.byId(containerID)
          let isAppend = el.getAttribute(phxUpdate) === "append"
          if(isAppend){
            idsBefore.reverse().forEach(id => {
              maybe(document.getElementById(id), child => el.insertBefore(child, el.firstChild))
            })
          } else {
            idsBefore.forEach(id => {
              maybe(document.getElementById(id), child => el.appendChild(child))
            })
          }
        })
      })
    }

    liveSocket.silenceEvents(() => DOM.restoreFocus(focused, selectionStart, selectionEnd))
    DOM.dispatchEvent(document, "phx:update")
    added.forEach(el => this.trackAfter("added", el))
    updates.forEach(el => this.trackAfter("updated", el))

    return true
  }

  forceFocusedSelectUpdate(fromEl, toEl){
    return fromEl.multiple === true || fromEl.innerHTML != toEl.innerHTML
  }

  isCIDPatch(){ return this.cidPatch }

  skipCIDSibling(el){
    return el.nodeType === Node.ELEMENT_NODE && el.getAttribute(PHX_SKIP) !== null
  }

  targetCIDContainer(){ if(!this.isCIDPatch()){ return }
    let [first, ...rest] = DOM.findComponentNodeList(this.container, this.targetCID)
    if(rest.length === 0){
      return first
    } else {
      return first && first.parentNode
    }
  }

  // builds HTML for morphdom patch
  // - for full patches of LiveView or a component with a single
  //   root node, simply returns the HTML
  // - for patches of a component with multiple root nodes, the
  //   parent node becomes the target container and non-component
  //   siblings are marked as skip.
  buildDiffHTML(container, html, phxUpdate, targetContainer){
    let isCIDPatch = this.isCIDPatch()
    let isCIDWithSingleRoot = isCIDPatch && targetContainer.getAttribute(PHX_COMPONENT) === this.targetCID.toString()
    if(!isCIDPatch || isCIDWithSingleRoot){
      return html
    } else {
      // component patch with multiple CID roots
      let diffContainer = null
      let template = document.createElement("template")
      diffContainer = DOM.cloneNode(targetContainer)
      let [firstComponent, ...rest] = DOM.findComponentNodeList(diffContainer, this.targetCID)
      template.innerHTML = html
      rest.forEach(el => el.remove())
      Array.from(diffContainer.childNodes).forEach(child => {
        if(child.nodeType === Node.ELEMENT_NODE && child.getAttribute(PHX_COMPONENT) !== this.targetCID.toString()){
          child.setAttribute(PHX_SKIP, "")
          child.innerHTML = ""
        }
      })
      Array.from(template.content.childNodes).forEach(el => diffContainer.insertBefore(el, firstComponent))
      firstComponent.remove()
      return diffContainer.outerHTML
    }
  }
}

export class View {
  constructor(el, liveSocket, parentView, href, flash){
    this.liveSocket = liveSocket
    this.flash = flash
    this.parent = parentView
    this.root = parentView ? parentView.root : this
    this.el = el
    this.id = this.el.id
    this.view = this.el.getAttribute(PHX_VIEW)
    this.ref = 0
    this.childJoins = 0
    this.loaderTimer = null
    this.pendingDiffs = []
    this.href = href
    this.joinCount = this.parent ? this.parent.joinCount - 1 : 0
    this.joinPending = true
    this.destroyed = false
    this.joinCallback = function(){}
    this.stopCallback = function(){}
    this.pendingJoinOps = this.parent ? null : []
    this.viewHooks = {}
    this.children = this.parent ? null : {}
    this.root.children[this.id] = {}
    this.channel = this.liveSocket.channel(`lv:${this.id}`, () => {
      return {
        url: this.href,
        params: this.connectParams(),
        session: this.getSession(),
        static: this.getStatic(),
        flash: this.flash
      }
    })
    this.showLoader(this.liveSocket.loaderTimeout)
    this.bindChannel()
  }

  isMain(){ return this.liveSocket.main === this }

  connectParams(){
    let params = this.liveSocket.params(this.view)
    let manifest =
      DOM.all(document, `[${this.binding(PHX_TRACK_STATIC)}]`)
      .map(node => node.src || node.href).filter(url => typeof(url) === "string")

    if(manifest.length > 0){ params["_track_static"] = manifest }
    params["_mounts"] = this.joinCount

    return params
  }

  name(){ return this.view }

  isConnected(){ return this.channel.canPush() }

  getSession(){ return this.el.getAttribute(PHX_SESSION) }

  getStatic(){
    let val = this.el.getAttribute(PHX_STATIC)
    return val === "" ? null : val
  }

  destroy(callback = function(){}){
    this.destroyAllChildren()
    this.destroyed = true
    delete this.root.children[this.id]
    if(this.parent){ delete this.root.children[this.parent.id][this.id] }
    clearTimeout(this.loaderTimer)
    let onFinished = () => {
      callback()
      for(let id in this.viewHooks){ this.destroyHook(this.viewHooks[id]) }
    }

    this.log("destroyed", () => ["the child has been removed from the parent"])
    this.channel.leave()
      .receive("ok", onFinished)
      .receive("error", onFinished)
      .receive("timeout", onFinished)
  }

  setContainerClasses(...classes){
    this.el.classList.remove(
      PHX_CONNECTED_CLASS,
      PHX_DISCONNECTED_CLASS,
      PHX_ERROR_CLASS
    )
    this.el.classList.add(...classes)
  }

  isLoading(){ return this.el.classList.contains(PHX_DISCONNECTED_CLASS)}

  showLoader(timeout){
    clearTimeout(this.loaderTimer)
    if(timeout){
      this.loaderTimer = setTimeout(() => this.showLoader(), timeout)
    } else {
      for(let id in this.viewHooks){ this.viewHooks[id].__trigger__("disconnected") }
      this.setContainerClasses(PHX_DISCONNECTED_CLASS)
    }
  }

  hideLoader(){
    clearTimeout(this.loaderTimer)
    this.setContainerClasses(PHX_CONNECTED_CLASS)
  }

  triggerReconnected(){
    for(let id in this.viewHooks){ this.viewHooks[id].__trigger__("reconnected") }
  }

  log(kind, msgCallback){
    this.liveSocket.log(this, kind, msgCallback)
  }

  onJoin(resp){
    let {rendered} = resp
    this.joinCount++
    this.childJoins = 0
    this.joinPending = true
    this.flash = null

    this.log("join", () => ["", rendered])
    if(rendered.title){ DOM.putTitle(rendered.title) }
    Browser.dropLocal(this.name(), CONSECUTIVE_RELOADS)
    this.rendered = new Rendered(this.id, rendered)
    let html = this.renderContainer(null, "join")
    this.dropPendingRefs()
    let forms = this.formsForRecovery(html)

    if(this.joinCount > 1 && forms.length > 0){
      forms.forEach((form, i) => {
        this.pushFormRecovery(form, resp => {
          if(i === forms.length - 1){
            this.onJoinComplete(resp, html)
          }
        })
      })
    } else {
      this.onJoinComplete(resp, html)
    }
  }

  dropPendingRefs(){ DOM.all(this.el, `[${PHX_REF}]`, el => el.removeAttribute(PHX_REF)) }

  onJoinComplete({live_patch}, html){
    if(this.joinCount > 1 || (this.parent && !this.parent.isJoinPending())){
      return this.applyJoinPatch(live_patch, html)
    }

    let newChildren = DOM.findPhxChildrenInFragment(html, this.id).filter(c => this.joinChild(c))
    if(newChildren.length === 0){
      if(this.parent){
        this.root.pendingJoinOps.push([this, () => this.applyJoinPatch(live_patch, html)])
        this.parent.ackJoin(this)
      } else {
        this.onAllChildJoinsComplete()
        this.applyJoinPatch(live_patch, html)
      }
    } else {
      this.root.pendingJoinOps.push([this, () => this.applyJoinPatch(live_patch, html)])
    }
  }

  attachTrueDocEl(){
    this.el = DOM.byId(this.id)
    this.el.setAttribute(PHX_ROOT_ID, this.root.id)
  }

  applyJoinPatch(live_patch, html){
    this.attachTrueDocEl()
    let patch = new DOMPatch(this, this.el, this.id, html, null)
    patch.markPrunableContentForRemoval()
    this.joinPending = false
    this.performPatch(patch)
    this.joinNewChildren()
    DOM.all(this.el, `[${this.binding(PHX_HOOK)}]`, hookEl => {
      let hook = this.addHook(hookEl)
      if(hook){ hook.__trigger__("mounted") }
    })

    this.applyPendingUpdates()

    if(live_patch){
      let {kind, to} = live_patch
      this.liveSocket.historyPatch(to, kind)
    }
    this.hideLoader()
    if(this.joinCount > 1){ this.triggerReconnected() }
    this.stopCallback()
  }

  performPatch(patch){
    let destroyedCIDs = []
    let phxChildrenAdded = false
    let updatedHookIds = new Set()

    patch.after("added", el => {
      let newHook = this.addHook(el)
      if(newHook){ newHook.__trigger__("mounted") }
    })

    patch.after("phxChildAdded", el => phxChildrenAdded = true)

    patch.before("updated", (fromEl, toEl) => {
      let hook = this.getHook(fromEl)
      let isIgnored = hook && fromEl.getAttribute(this.binding(PHX_UPDATE)) === "ignore"
      if(hook && !fromEl.isEqualNode(toEl) && !(isIgnored && isEqualObj(fromEl.dataset, toEl.dataset))){
        updatedHookIds.add(fromEl.id)
        hook.__trigger__("beforeUpdate")
      }
    })

    patch.after("updated", el => {
      let hook = this.getHook(el)
      if(hook && updatedHookIds.has(el.id)){ hook.__trigger__("updated") }
    })

    patch.before("discarded", (el) => {
      let hook = this.getHook(el)
      if(hook){ hook.__trigger__("beforeDestroy") }
    })

    patch.after("discarded", (el) => {
      let cid = this.componentID(el)
      if(typeof(cid) === "number" && destroyedCIDs.indexOf(cid) === -1){ destroyedCIDs.push(cid) }
      let hook = this.getHook(el)
      hook && this.destroyHook(hook)
    })

    patch.perform()
    this.maybePushComponentsDestroyed(destroyedCIDs)

    return phxChildrenAdded
  }

  joinNewChildren(){
    DOM.findPhxChildren(this.el, this.id).forEach(el => this.joinChild(el))
  }

  getChildById(id){ return this.root.children[this.id][id] }

  getDescendentByEl(el){
    if(el.id === this.id){
      return this
    } else {
      return this.children[el.getAttribute(PHX_PARENT_ID)][el.id]
    }
  }

  destroyDescendent(id){
    for(let parentId in this.root.children){
      for(let childId in this.root.children[parentId]){
        if(childId === id){ return this.root.children[parentId][childId].destroy() }
      }
    }
  }

  joinChild(el){
    let child = this.getChildById(el.id)
    if(!child){
      let view = new View(el, this.liveSocket, this)
      this.root.children[this.id][view.id] = view
      view.join()
      this.childJoins++
      return true
    }
  }

  isJoinPending(){ return this.joinPending }

  ackJoin(child){
    this.childJoins--

    if(this.childJoins === 0){
      if(this.parent){
        this.parent.ackJoin(this)
      } else {
        this.onAllChildJoinsComplete()
      }
    }
  }

  onAllChildJoinsComplete(){
    this.joinCallback()
    this.pendingJoinOps.forEach(([view, op]) => {
      if(!view.isDestroyed()){ op() }
    })
    this.pendingJoinOps = []
  }

  update(diff, cidAck, ref){
    if(isEmpty(diff) && ref === null){ return }
    if(diff.title){ DOM.putTitle(diff.title) }
    if(this.isJoinPending() || this.liveSocket.hasPendingLink()){ return this.pendingDiffs.push({diff, cid: cidAck, ref}) }

    this.log("update", () => ["", diff])
    this.rendered.mergeDiff(diff)
    let phxChildrenAdded = false

    // when we don't have an acknowledgement CID and the diff only contains
    // component diffs, then walk components and patch only the parent component
    // containers found in the diff. Otherwise, patch entire LV container.
    if(typeof(cidAck) === "number"){
      this.liveSocket.time("component ack patch complete", () => {
        if(this.componentPatch(diff[COMPONENTS][cidAck], cidAck, ref)){ phxChildrenAdded = true }
      })
    } else if(this.rendered.isComponentOnlyDiff(diff)){
      this.liveSocket.time("component patch complete", () => {
        let parentCids = DOM.findParentCIDs(this.el, this.rendered.componentCIDs(diff))
        parentCids.forEach(parentCID => {
          if(this.componentPatch(diff[COMPONENTS][parentCID], parentCID, ref)){ phxChildrenAdded = true }
        })
      })
    } else if(!isEmpty(diff)){
      this.liveSocket.time("full patch complete", () => {
        let html = this.renderContainer(diff, "update")
        let patch = new DOMPatch(this, this.el, this.id, html, null, ref)
        phxChildrenAdded = this.performPatch(patch)
      })
    }

    DOM.undoRefs(ref, this.el)
    if(phxChildrenAdded){ this.joinNewChildren() }
  }

  renderContainer(diff, kind){
    return this.liveSocket.time(`toString diff (${kind})`, () => {
      let tag = this.el.tagName
      let cids = diff ? this.rendered.componentCIDs(diff) : null
      let html = this.rendered.toString(cids)
      return `<${tag}>${html}</${tag}>`
    })
  }

  componentPatch(diff, cid, ref){
    if(isEmpty(diff)) return false
    let html = this.rendered.componentToString(cid)
    let patch = new DOMPatch(this, this.el, this.id, html, cid, ref)
    let childrenAdded = this.performPatch(patch)
    return childrenAdded
  }

  getHook(el){ return this.viewHooks[ViewHook.elementID(el)] }

  addHook(el){ if(ViewHook.elementID(el) || !el.getAttribute){ return }
    let hookName = el.getAttribute(this.binding(PHX_HOOK))
    if(hookName && !this.ownsElement(el)){ return }
    let callbacks = this.liveSocket.getHookCallbacks(hookName)

    if(callbacks){
      let hook = new ViewHook(this, el, callbacks)
      this.viewHooks[ViewHook.elementID(hook.el)] = hook
      return hook
    } else if(hookName !== null){
      logError(`unknown hook found for "${hookName}"`, el)
    }
  }

  destroyHook(hook){
    hook.__trigger__("destroyed")
    delete this.viewHooks[ViewHook.elementID(hook.el)]
  }

  applyPendingUpdates(){
    this.pendingDiffs.forEach(({diff, cid, ref}) => this.update(diff, cid, ref))
    this.pendingDiffs = []
  }

  onChannel(event, cb){
    this.liveSocket.onChannel(this.channel, event, resp => {
      if(this.isJoinPending()){
        this.root.pendingJoinOps.push([this, () => cb(resp)])
      } else {
        cb(resp)
      }
    })
  }

  bindChannel(){
    this.onChannel("diff", (diff) => this.update(diff))
    this.onChannel("redirect", ({to, flash}) => this.onRedirect({to, flash}))
    this.onChannel("live_patch", (redir) => this.onLivePatch(redir))
    this.onChannel("live_redirect", (redir) => this.onLiveRedirect(redir))
    this.onChannel("session", ({token}) => this.el.setAttribute(PHX_SESSION, token))
    this.channel.onError(reason => this.onError(reason))
    this.channel.onClose(() => this.onError({reason: "closed"}))
  }

  destroyAllChildren(){
    for(let id in this.root.children[this.id]){
      this.getChildById(id).destroy()
    }
  }

  onLiveRedirect(redir){
    let {to, kind, flash} = redir
    let url = this.expandURL(to)
    this.liveSocket.historyRedirect(url, kind, flash)
  }

  onLivePatch(redir){
    let {to, kind} = redir
    this.href = this.expandURL(to)
    this.liveSocket.historyPatch(to, kind)
  }

  expandURL(to){
    return to.startsWith("/") ? `${window.location.protocol}//${window.location.host}${to}` : to
  }

  onRedirect({to, flash}){ this.liveSocket.redirect(to, flash) }

  isDestroyed(){ return this.destroyed }

  join(callback){
    if(!this.parent){
      this.stopCallback = this.liveSocket.withPageLoading({to: this.href, kind: "initial"})
    }
    this.joinCallback = () => callback && callback(this, this.joinCount)
    this.liveSocket.wrapPush(() => {
      return this.channel.join()
        .receive("ok", data => this.onJoin(data))
        .receive("error", resp => this.onJoinError(resp))
        .receive("timeout", () => this.onJoinError({reason: "timeout"}))
    })
  }

  onJoinError(resp){
    if(resp.redirect || resp.live_redirect){ this.channel.leave() }
    if(resp.redirect){ return this.onRedirect(resp.redirect) }
    if(resp.live_redirect){ return this.onLiveRedirect(resp.live_redirect) }
    this.log("error", () => ["unable to join", resp])
    return this.liveSocket.reloadWithJitter(this)
  }

  onError(reason){
    if(this.isJoinPending()){ return this.liveSocket.reloadWithJitter(this) }
    this.destroyAllChildren()
    this.log("error", () => ["view crashed", reason])
    this.liveSocket.onViewError(this)
    document.activeElement.blur()
    if(this.liveSocket.isUnloaded()){
      this.showLoader(BEFORE_UNLOAD_LOADER_TIMEOUT)
    } else {
      this.displayError()
    }
  }

  displayError(){
    if(this.isMain()){ DOM.dispatchEvent(window, "phx:page-loading-start", {to: this.href, kind: "error"}) }
    this.showLoader()
    this.setContainerClasses(PHX_DISCONNECTED_CLASS, PHX_ERROR_CLASS)
  }

  pushWithReply(refGenerator, event, payload, onReply = function(){ }){
    let [ref, [el]] = refGenerator ? refGenerator() : [null, []]
    let onLoadingDone = function(){}
    if(el && (el.getAttribute(this.binding(PHX_PAGE_LOADING)) !== null)){
      onLoadingDone = this.liveSocket.withPageLoading({kind: "element", target: el})
    }

    if(typeof(payload.cid) !== "number"){ delete payload.cid }
    return(
      this.liveSocket.wrapPush(() => {
        return this.channel.push(event, payload, PUSH_TIMEOUT).receive("ok", resp => {
          if(resp.diff || ref !== null){ this.update(resp.diff || {}, payload.cid, ref) }
          if(resp.redirect){ this.onRedirect(resp.redirect) }
          if(resp.live_patch){ this.onLivePatch(resp.live_patch) }
          if(resp.live_redirect){ this.onLiveRedirect(resp.live_redirect) }
          onLoadingDone()
          onReply(resp)
        })
      })
    )
  }

  putRef(elements, event){
    let newRef = this.ref++
    let disableWith = this.binding(PHX_DISABLE_WITH)

    elements.forEach(el => {
      el.classList.add(`phx-${event}-loading`)
      el.setAttribute(PHX_REF, newRef)
      let disableText = el.getAttribute(disableWith)
      if(disableText !== null){
        if(!el.getAttribute(PHX_DISABLE_WITH_RESTORE)){
          el.setAttribute(PHX_DISABLE_WITH_RESTORE, el.innerText)
        }
        el.innerText = disableText
      }
    })
    return [newRef, elements]
  }

  componentID(el){
    let cid = el.getAttribute && el.getAttribute(PHX_COMPONENT)
    return cid ? parseInt(cid) : null
  }

  targetComponentID(target, targetCtx){
    if(target.getAttribute(this.binding("target"))){
      return this.closestComponentID(targetCtx)
    } else {
      return null
    }
  }

  closestComponentID(targetCtx){
    if(targetCtx){
      return maybe(targetCtx.closest(`[${PHX_COMPONENT}]`), el => this.ownsElement(el) && this.componentID(el))
    } else {
      return null
    }
  }

  pushHookEvent(targetCtx, event, payload){
    this.pushWithReply(null, "event", {
      type: "hook",
      event: event,
      value: payload,
      cid: this.closestComponentID(targetCtx)
    })
  }

  extractMeta(el, meta){
    let prefix = this.binding("value-")
    for (let i = 0; i < el.attributes.length; i++){
      let name = el.attributes[i].name
      if(name.startsWith(prefix)){ meta[name.replace(prefix, "")] = el.getAttribute(name) }
    }
    if(el.value !== undefined){
      meta.value = el.value

      if (el.tagName === "INPUT" && CHECKABLE_INPUTS.indexOf(el.type) >= 0 && !el.checked) {
        delete meta.value
      }
    }
    return meta
  }

  pushEvent(type, el, targetCtx, phxEvent, meta){
    this.pushWithReply(() => this.putRef([el], type), "event", {
      type: type,
      event: phxEvent,
      value: this.extractMeta(el, meta),
      cid: this.targetComponentID(el, targetCtx)
    })
  }

  pushKey(keyElement, targetCtx, kind, phxEvent, meta){
    this.pushWithReply(() => this.putRef([keyElement], kind), "event", {
      type: kind,
      event: phxEvent,
      value: this.extractMeta(keyElement, meta),
      cid: this.targetComponentID(keyElement, targetCtx)
    })
  }

  pushInput(inputEl, targetCtx, phxEvent, eventTarget, callback){
    DOM.dispatchEvent(inputEl.form, PHX_CHANGE_EVENT, {triggeredBy: inputEl})
    this.pushWithReply(() => this.putRef([inputEl, inputEl.form], "change"), "event", {
      type: "form",
      event: phxEvent,
      value: serializeForm(inputEl.form, {_target: eventTarget.name}),
      cid: this.targetComponentID(inputEl.form, targetCtx)
    }, callback)
  }

  pushFormSubmit(formEl, targetCtx, phxEvent, onReply){
    let filterIgnored = el => !closestPhxBinding(el, `${this.binding(PHX_UPDATE)}=ignore`, el.form)
    let refGenerator = () => {
      let disables = DOM.all(formEl, `[${this.binding(PHX_DISABLE_WITH)}]`)
      let buttons = DOM.all(formEl, "button").filter(filterIgnored)
      let inputs = DOM.all(formEl, "input").filter(filterIgnored)

      buttons.forEach(button => {
        button.setAttribute(PHX_DISABLED, button.disabled)
        button.disabled = true
      })
      inputs.forEach(input => {
        input.setAttribute(PHX_READONLY, input.readOnly)
        input.readOnly = true
      })
      formEl.setAttribute(this.binding(PHX_PAGE_LOADING), "")
      return this.putRef([formEl].concat(disables).concat(buttons).concat(inputs), "submit")
    }
    this.pushWithReply(refGenerator, "event", {
      type: "form",
      event: phxEvent,
      value: serializeForm(formEl),
      cid: this.targetComponentID(formEl, targetCtx)
    }, onReply)
  }

  pushFormRecovery(form, callback){
    this.liveSocket.withinOwners(form, (view, targetCtx) => {
      let input = form.elements[0]
      let phxEvent = form.getAttribute(this.binding(PHX_AUTO_RECOVER)) || form.getAttribute(this.binding("change"))
      view.pushInput(input, targetCtx, phxEvent, input, callback)
    })
  }

  pushLinkPatch(href, targetEl, callback){
    if(!this.isLoading()){ this.showLoader(this.liveSocket.loaderTimeout) }
    let linkRef = this.liveSocket.setPendingLink(href)
    let refGen = targetEl ? () => this.putRef([targetEl], "click") : null

    this.pushWithReply(refGen, "link", {url: href}, resp => {
      if(resp.link_redirect){
        this.liveSocket.replaceMain(href, null, callback, linkRef)
      } else if(this.liveSocket.commitPendingLink(linkRef)){
        this.href = href
        this.applyPendingUpdates()
        this.hideLoader()
        this.triggerReconnected()
        callback && callback()
      }
    }).receive("timeout", () => this.liveSocket.redirect(window.location.href))
  }

  formsForRecovery(html){
    let phxChange = this.binding("change")
    let template = document.createElement("template")
    template.innerHTML = html

    return(
      DOM.all(this.el, `form[${phxChange}]`)
         .filter(form => this.ownsElement(form))
         .filter(form => form.getAttribute(this.binding(PHX_AUTO_RECOVER)) !== "ignore")
         .filter(form => template.content.querySelector(`form[${phxChange}="${form.getAttribute(phxChange)}"]`))
    )
  }

  maybePushComponentsDestroyed(destroyedCIDs){
    let completelyDestroyedCIDs = destroyedCIDs.filter(cid => {
      return DOM.findComponentNodeList(this.el, cid).length === 0
    })
    if(completelyDestroyedCIDs.length > 0){
      this.pushWithReply(null, "cids_destroyed", {cids: completelyDestroyedCIDs}, () => {
        this.rendered.pruneCIDs(completelyDestroyedCIDs)
      })
    }
  }

  ownsElement(el){
    return el.getAttribute(PHX_PARENT_ID) === this.id ||
           maybe(el.closest(PHX_VIEW_SELECTOR), node => node.id) === this.id
  }

  submitForm(form, targetCtx, phxEvent){
    DOM.putPrivate(form, PHX_HAS_SUBMITTED, true)
    this.liveSocket.blurActiveElement(this)
    this.pushFormSubmit(form, targetCtx, phxEvent, () => {
      this.liveSocket.restorePreviouslyActiveFocus()
    })
  }

  binding(kind){ return this.liveSocket.binding(kind)}
}

let viewHookID = 1
class ViewHook {
  static makeID(){ return viewHookID++ }
  static elementID(el){ return el.phxHookId }

  constructor(view, el, callbacks){
    this.__view = view
    this.__liveSocket = view.liveSocket
    this.__callbacks = callbacks
    this.el = el
    this.viewName = view.name()
    this.el.phxHookId = this.constructor.makeID()
    for(let key in this.__callbacks){ this[key] = this.__callbacks[key] }
  }

  pushEvent(event, payload = {}){
    this.__view.pushHookEvent(null, event, payload)
  }

  pushEventTo(phxTarget, event, payload = {}){
    this.__liveSocket.withinTargets(null, phxTarget, (view, targetCtx) => {
      view.pushHookEvent(targetCtx, event, payload)
    })
  }

  __trigger__(kind){
    let callback = this.__callbacks[kind]
    callback && callback.call(this)
  }
}

export default LiveSocket
