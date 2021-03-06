defmodule Phoenix.LiveViewTest.ClientProxy do
  @moduledoc false
  use GenServer

  defstruct session_token: nil,
            static_token: nil,
            module: nil,
            endpoint: nil,
            pid: nil,
            proxy: nil,
            topic: nil,
            ref: nil,
            rendered: nil,
            children: [],
            child_statics: %{},
            id: nil,
            connect_params: %{},
            connect_info: %{}

  alias Phoenix.LiveViewTest.{ClientProxy, DOM, Element, View}

  @doc """
  Encoding used by the Channel serializer.
  """
  def encode!(msg), do: msg

  @doc """
  Starts a client proxy.

  ## Options

    * `:caller` - the required `{ref, pid}` pair identifying the caller.
    * `:view` - the required `%Phoenix.LiveViewTest.View{}`
    * `:html` - the required string of HTML for the document.

  """
  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts)
  end

  def init(opts) do
    # Since we are always running in the test client,
    # we will disable our own logging and let the client
    # do the job.
    Logger.disable(self())

    {_caller_pid, _caller_ref} = caller = Keyword.fetch!(opts, :caller)
    root_html = Keyword.fetch!(opts, :html)
    root_view = Keyword.fetch!(opts, :proxy)
    session = Keyword.fetch!(opts, :session)
    url = Keyword.fetch!(opts, :url)
    test_supervisor = Keyword.fetch!(opts, :test_supervisor)

    state = %{
      join_ref: 0,
      ref: 0,
      caller: caller,
      views: %{},
      ids: %{},
      pids: %{},
      replies: %{},
      root_view: nil,
      html: root_html,
      session: session,
      test_supervisor: test_supervisor,
      url: url
    }

    try do
      {root_view, rendered} = mount_view(state, root_view, url)

      new_state =
        state
        |> Map.put(:root_view, root_view)
        |> put_view(root_view, rendered)
        |> detect_added_or_removed_children(root_view, root_html)

      send_caller(new_state, {:ok, build_view(root_view), DOM.to_html(new_state.html)})
      {:ok, new_state}
    catch
      :throw, {:stop, {:shutdown, reason}, _state} ->
        send_caller(state, {:error, reason})
        :ignore

      :throw, {:stop, reason, _} ->
        Process.unlink(elem(caller, 0))
        {:stop, reason}
    end
  end

  defp build_view(%ClientProxy{} = proxy) do
    %{id: id, ref: ref, topic: topic, module: module, endpoint: endpoint, pid: pid} = proxy
    %View{id: id, pid: pid, proxy: {ref, topic, self()}, module: module, endpoint: endpoint}
  end

  defp mount_view(state, view, url) do
    ref = make_ref()

    case start_supervised_channel(state, view, ref, url) do
      {:ok, pid} ->
        mon_ref = Process.monitor(pid)

        receive do
          {^ref, {:ok, %{rendered: rendered}}} ->
            Process.demonitor(mon_ref, [:flush])
            {%{view | pid: pid}, rendered}

          {^ref, {:error, %{live_redirect: opts}}} ->
            throw(stop_redirect(state, view.topic, {:live_redirect, opts}))

          {^ref, {:error, %{redirect: opts}}} ->
            throw(stop_redirect(state, view.topic, {:redirect, opts}))

          {^ref, {:error, reason}} ->
            throw({:stop, reason, state})

          {:DOWN, ^mon_ref, _, _, reason} ->
            throw({:stop, reason, state})
        end

      {:error, reason} ->
        throw({:stop, reason, state})
    end
  end

  defp start_supervised_channel(state, view, ref, url) do
    socket = %Phoenix.Socket{
      transport_pid: self(),
      serializer: __MODULE__,
      channel: view.module,
      endpoint: view.endpoint,
      private: %{connect_info: Map.put_new(view.connect_info, :session, state.session)},
      topic: view.topic,
      join_ref: state.join_ref
    }

    params = %{
      "session" => view.session_token,
      "static" => view.static_token,
      "url" => url,
      "params" => Map.put(view.connect_params, "_mounts", 0),
      "caller" => state.caller
    }

    spec = %{
      id: make_ref(),
      start: {Phoenix.LiveView.Channel, :start_link, [{params, {self(), ref}, socket}]},
      restart: :temporary
    }

    Supervisor.start_child(state.test_supervisor, spec)
  end

  def handle_info({:sync_children, topic, from}, state) do
    view = fetch_view_by_topic!(state, topic)

    children =
      Enum.flat_map(view.children, fn {id, _session} ->
        case fetch_view_by_id(state, id) do
          {:ok, child} -> [build_view(child)]
          :error -> []
        end
      end)

    GenServer.reply(from, {:ok, children})
    {:noreply, state}
  end

  def handle_info({:sync_render, operation, topic_or_element, from}, state) do
    view = fetch_view_by_topic!(state, proxy_topic(topic_or_element))
    result = state |> root(view) |> select_node(topic_or_element)

    reply =
      case {operation, result} do
        {:find_element, {:ok, node}} -> {:ok, node}
        {:find_element, {:error, _, message}} -> {:raise, ArgumentError.exception(message)}
        {:has_element?, {:error, :none, _}} -> {:ok, false}
        {:has_element?, _} -> {:ok, true}
      end

    GenServer.reply(from, reply)
    {:noreply, state}
  end

  def handle_info(
        %Phoenix.Socket.Message{
          event: "redirect",
          topic: _topic,
          payload: %{to: _to} = opts
        },
        state
      ) do
    stop_redirect(state, state.root_view.topic, {:redirect, opts})
  end

  def handle_info(
        %Phoenix.Socket.Message{
          event: "live_patch",
          topic: _topic,
          payload: %{to: _to} = opts
        },
        state
      ) do
    send_patch(state, state.root_view.topic, opts)
    {:noreply, state}
  end

  def handle_info(
        %Phoenix.Socket.Message{
          event: "live_redirect",
          topic: _topic,
          payload: %{to: _to} = opts
        },
        state
      ) do
    stop_redirect(state, state.root_view.topic, {:live_redirect, opts})
  end

  def handle_info(
        %Phoenix.Socket.Message{
          event: "diff",
          topic: topic,
          payload: diff
        },
        state
      ) do
    {:noreply, merge_rendered(state, topic, diff)}
  end

  def handle_info(%Phoenix.Socket.Reply{} = reply, state) do
    %{ref: ref, payload: payload, topic: topic} = reply

    case fetch_reply(state, ref) do
      {:ok, {from, _pid}} ->
        state = drop_reply(state, ref)

        case payload do
          %{live_redirect: %{to: _to} = opts} ->
            stop_redirect(state, topic, {:live_redirect, opts})

          %{live_patch: %{to: _to} = opts} ->
            send_patch(state, topic, opts)
            {:noreply, render_reply(reply, from, state)}

          %{redirect: %{to: _to} = opts} ->
            stop_redirect(state, topic, {:redirect, opts})

          %{} ->
            {:noreply, render_reply(reply, from, state)}
        end

      :error ->
        {:noreply, state}
    end
  end

  def handle_info({:DOWN, _ref, :process, pid, reason}, state) do
    case fetch_view_by_pid(state, pid) do
      {:ok, _view} ->
        {:stop, reason, state}

      :error ->
        {:noreply, state}
    end
  end

  def handle_info({:socket_close, pid, reason}, state) do
    {:ok, view} = fetch_view_by_pid(state, pid)
    {:noreply, drop_view_by_id(state, view.id, reason)}
  end

  def handle_call({:live_children, topic}, from, state) do
    view = fetch_view_by_topic!(state, topic)
    :ok = Phoenix.LiveView.Channel.ping(view.pid)
    send(self(), {:sync_children, view.topic, from})
    {:noreply, state}
  end

  def handle_call({:render, operation, topic_or_element}, from, state) do
    topic = proxy_topic(topic_or_element)
    %{pid: pid} = fetch_view_by_topic!(state, topic)
    :ok = Phoenix.LiveView.Channel.ping(pid)
    send(self(), {:sync_render, operation, topic_or_element, from})
    {:noreply, state}
  end

  def handle_call({:render_event, topic_or_element, type, value}, from, state) do
    result =
      case topic_or_element do
        {topic, event} ->
          view = fetch_view_by_topic!(state, topic)
          {view, nil, event, stringify(value, & &1)}

        %Element{} = element ->
          view = fetch_view_by_topic!(state, proxy_topic(element))
          root = root(state, view)

          with {:ok, node} <- select_node(root, element),
               :ok <- maybe_enabled(type, node, element),
               {:ok, event} <- maybe_event(type, node, element),
               {:ok, extra} <- maybe_values(type, node, element),
               {:ok, cid} <- maybe_cid(root, node) do
            {view, cid, event, DOM.deep_merge(extra, stringify_type(type, value))}
          end
      end

    case result do
      {view, cid, event, values} ->
        payload = %{
          "cid" => cid,
          "type" => Atom.to_string(type),
          "event" => event,
          "value" => encode(type, values)
        }

        {:noreply, push_with_reply(state, from, view, "event", payload)}

      {:patch, topic, path} ->
        handle_call({:render_patch, topic, path}, from, state)

      {:stop, topic, reason} ->
        stop_redirect(state, topic, reason)

      {:error, _, message} ->
        {:reply, {:raise, ArgumentError.exception(message)}, state}
    end
  end

  def handle_call({:render_patch, topic, path}, from, state) do
    view = fetch_view_by_topic!(state, topic)
    ref = to_string(state.ref + 1)

    send(view.pid, %Phoenix.Socket.Message{
      join_ref: state.join_ref,
      topic: view.topic,
      event: "link",
      payload: %{"url" => path},
      ref: ref
    })

    send_patch(state, state.root_view.topic, %{to: path})
    {:noreply, put_reply(%{state | ref: state.ref + 1}, ref, from, view.pid)}
  end

  defp drop_view_by_id(state, id, reason) do
    {:ok, view} = fetch_view_by_id(state, id)
    push(state, view, "phx_leave", %{})

    state =
      Enum.reduce(view.children, state, fn {child_id, _child_session}, acc ->
        drop_view_by_id(acc, child_id, reason)
      end)

    flush_replies(
      %{
        state
        | ids: Map.delete(state.ids, view.id),
          views: Map.delete(state.views, view.topic),
          pids: Map.delete(state.pids, view.pid)
      },
      view.pid,
      reason
    )
  end

  defp flush_replies(state, pid, reason) do
    Enum.reduce(state.replies, state, fn
      {ref, {from, ^pid}}, acc ->
        GenServer.reply(from, {:error, reason})
        drop_reply(acc, ref)

      {_ref, {_from, _pid}}, acc ->
        acc
    end)
  end

  defp fetch_reply(state, ref) do
    Map.fetch(state.replies, ref)
  end

  defp put_reply(state, ref, from, pid) do
    %{state | replies: Map.put(state.replies, ref, {from, pid})}
  end

  defp drop_reply(state, ref) do
    %{state | replies: Map.delete(state.replies, ref)}
  end

  defp put_child(state, %ClientProxy{} = parent, id, session) do
    update_in(state, [:views, parent.topic], fn %ClientProxy{} = parent ->
      %ClientProxy{parent | children: [{id, session} | parent.children]}
    end)
  end

  defp drop_child(state, %ClientProxy{} = parent, id, reason) do
    state
    |> update_in([:views, parent.topic], fn %ClientProxy{} = parent ->
      new_children = Enum.reject(parent.children, fn {cid, _session} -> id == cid end)
      %ClientProxy{parent | children: new_children}
    end)
    |> drop_view_by_id(id, reason)
  end

  defp verify_session(%ClientProxy{} = view) do
    Phoenix.LiveView.Static.verify_session(view.endpoint, view.session_token, view.static_token)
  end

  defp put_view(state, %ClientProxy{pid: pid} = view, rendered) do
    {:ok, %{view: module}} = verify_session(view)
    new_view = %ClientProxy{view | module: module, proxy: self(), pid: pid, rendered: rendered}
    Process.monitor(pid)

    patch_view(
      %{
        state
        | views: Map.put(state.views, new_view.topic, new_view),
          pids: Map.put(state.pids, pid, new_view.topic),
          ids: Map.put(state.ids, new_view.id, new_view.topic)
      },
      view,
      DOM.render_diff(rendered)
    )
  end

  defp patch_view(state, view, child_html) do
    case DOM.patch_id(view.id, state.html, child_html) do
      {new_html, [_ | _] = deleted_cids} ->
        push(%{state | html: new_html}, view, "cids_destroyed", %{"cids" => deleted_cids})

      {new_html, [] = _deleted_cids} ->
        %{state | html: new_html}
    end
  end

  defp stop_redirect(%{caller: {pid, _}} = state, topic, {_kind, opts} = reason)
       when is_binary(topic) do
    send_caller(state, {:redirect, topic, opts})
    Process.unlink(pid)
    {:stop, {:shutdown, reason}, state}
  end

  defp fetch_view_by_topic!(state, topic), do: Map.fetch!(state.views, topic)
  defp fetch_view_by_topic(state, topic), do: Map.fetch(state.views, topic)

  defp fetch_view_by_pid(state, pid) when is_pid(pid) do
    with {:ok, topic} <- Map.fetch(state.pids, pid) do
      fetch_view_by_topic(state, topic)
    end
  end

  defp fetch_view_by_id(state, id) do
    with {:ok, topic} <- Map.fetch(state.ids, id) do
      fetch_view_by_topic(state, topic)
    end
  end

  defp render_reply(reply, from, state) do
    %{payload: diff, topic: topic} = reply
    new_state = merge_rendered(state, topic, diff)

    case fetch_view_by_topic(new_state, topic) do
      {:ok, view} ->
        GenServer.reply(from, {:ok, new_state.html |> DOM.inner_html!(view.id) |> DOM.to_html()})
        new_state

      :error ->
        new_state
    end
  end

  defp merge_rendered(state, topic, %{diff: diff}), do: merge_rendered(state, topic, diff)

  defp merge_rendered(%{html: html_before} = state, topic, %{} = diff) do
    case diff do
      %{title: new_title} -> send_caller(state, {:title, new_title})
      %{} -> :noop
    end

    case fetch_view_by_topic(state, topic) do
      {:ok, view} ->
        rendered = DOM.deep_merge(view.rendered, diff)
        new_view = %ClientProxy{view | rendered: rendered}

        %{state | views: Map.update!(state.views, topic, fn _ -> new_view end)}
        |> patch_view(new_view, DOM.render_diff(rendered))
        |> detect_added_or_removed_children(new_view, html_before)

      :error ->
        state
    end
  end

  defp detect_added_or_removed_children(state, view, html_before) do
    new_state = recursive_detect_added_or_removed_children(state, view, html_before)
    {:ok, new_view} = fetch_view_by_topic(new_state, view.topic)

    ids_after =
      new_state.html
      |> DOM.all("[data-phx-view]")
      |> DOM.all_attributes("id")
      |> MapSet.new()

    Enum.reduce(new_view.children, new_state, fn {id, _session}, acc ->
      if id in ids_after do
        acc
      else
        drop_child(acc, new_view, id, {:shutdown, :left})
      end
    end)
  end

  defp recursive_detect_added_or_removed_children(state, view, html_before) do
    state.html
    |> DOM.inner_html!(view.id)
    |> DOM.find_live_views()
    |> Enum.reduce(state, fn {id, session, static}, acc ->
      case fetch_view_by_id(acc, id) do
        {:ok, view} ->
          patch_view(acc, view, DOM.inner_html!(html_before, view.id))

        :error ->
          static = static || Map.get(state.root_view.child_statics, id)
          child_view = build_child(view, id: id, session_token: session, static_token: static)

          {child_view, rendered} = mount_view(acc, child_view, state.url)

          acc
          |> put_view(child_view, rendered)
          |> put_child(view, id, child_view.session_token)
          |> recursive_detect_added_or_removed_children(child_view, acc.html)
      end
    end)
  end

  defp send_caller(%{caller: {pid, ref}}, msg) when is_pid(pid) do
    send(pid, {ref, msg})
  end

  defp send_patch(state, topic, %{to: _to} = opts) do
    send_caller(state, {:patch, topic, opts})
  end

  defp push(state, view, event, payload) do
    ref = to_string(state.ref + 1)

    send(view.pid, %Phoenix.Socket.Message{
      join_ref: state.join_ref,
      topic: view.topic,
      event: event,
      payload: payload,
      ref: ref
    })

    %{state | ref: state.ref + 1}
  end

  defp push_with_reply(state, from, view, event, payload) do
    ref = to_string(state.ref + 1)

    state
    |> push(view, event, payload)
    |> put_reply(ref, from, view.pid)
  end

  def build(attrs) do
    attrs_with_defaults =
      attrs
      |> Keyword.merge(topic: Phoenix.LiveView.Utils.random_id())
      |> Keyword.put_new_lazy(:ref, fn -> make_ref() end)

    struct(__MODULE__, attrs_with_defaults)
  end

  def build_child(%ClientProxy{ref: ref, proxy: proxy} = parent, attrs) do
    attrs
    |> Keyword.merge(
      ref: ref,
      proxy: proxy,
      endpoint: parent.endpoint
    )
    |> build()
  end

  ## Element helpers

  defp proxy_topic(topic) when is_binary(topic), do: topic
  defp proxy_topic(%{proxy: {_ref, topic, _pid}}), do: topic

  defp root(state, view), do: DOM.by_id!(state.html, view.id)

  defp select_node(root, %Element{selector: selector, text_filter: nil}) do
    root
    |> DOM.child_nodes()
    |> DOM.maybe_one(selector)
  end

  defp select_node(root, %Element{selector: selector, text_filter: text_filter}) do
    nodes =
      root
      |> DOM.child_nodes()
      |> DOM.all(selector)

    filtered_nodes = Enum.filter(nodes, &(DOM.to_text(&1) =~ text_filter))

    case {nodes, filtered_nodes} do
      {_, [filtered_node]} ->
        {:ok, filtered_node}

      {[], _} ->
        {:error, :none,
         "selector #{inspect(selector)} did not return any element within: \n\n" <>
           DOM.inspect_html(root)}

      {[node], []} ->
        {:error, :none,
         "selector #{inspect(selector)} did not match text filter #{inspect(text_filter)}, " <>
           "got: \n\n#{DOM.inspect_html(node)}"}

      {_, []} ->
        {:error, :none,
         "selector #{inspect(selector)} returned #{length(nodes)} elements " <>
           "but none matched the text filter #{inspect(text_filter)}: \n\n" <>
           DOM.inspect_html(nodes)}

      {_, _} ->
        {:error, :many,
         "selector #{inspect(selector)} returned #{length(nodes)} elements " <>
           "and #{length(filtered_nodes)} of them matched the text filter #{inspect(text_filter)}: \n\n " <>
           DOM.inspect_html(filtered_nodes)}
    end
  end

  defp select_node(root, _topic) do
    {:ok, root}
  end

  defp maybe_cid(_tree, nil) do
    {:ok, nil}
  end

  defp maybe_cid(tree, node) do
    case DOM.all_attributes(node, "phx-target") do
      [] ->
        {:ok, nil}

      ["#" <> _ = target] ->
        with {:ok, target} <- DOM.maybe_one(tree, target, "phx-target") do
          if cid = DOM.component_id(target) do
            {:ok, String.to_integer(cid)}
          else
            {:ok, nil}
          end
        end

      [maybe_integer] ->
        case Integer.parse(maybe_integer) do
          {cid, ""} ->
            {:ok, cid}

          _ ->
            {:error, :invalid,
             "expected phx-target to be either an ID or a CID, got: #{inspect(maybe_integer)}"}
        end
    end
  end

  defp maybe_event(:hook, node, %Element{event: event} = element) do
    true = is_binary(event)

    if DOM.attribute(node, "phx-hook") do
      if DOM.attribute(node, "id") do
        {:ok, event}
      else
        {:error, :invalid,
         "element selected by #{inspect(element.selector)} for phx-hook does not have an ID"}
      end
    else
      {:error, :invalid,
       "element selected by #{inspect(element.selector)} does not have phx-hook attribute"}
    end
  end

  # TODO: Remove this once deprecated paths have been removed
  defp maybe_event(_, _, %{event: event}) when is_binary(event) do
    {:ok, event}
  end

  defp maybe_event(:click, {"a", _, _} = node, element) do
    cond do
      event = DOM.attribute(node, "phx-click") ->
        {:ok, event}

      to = DOM.attribute(node, "href") ->
        case DOM.attribute(node, "data-phx-link") do
          "patch" ->
            {:patch, proxy_topic(element), to}

          "redirect" ->
            kind = DOM.attribute(node, "data-phx-link-state") || "push"
            {:stop, proxy_topic(element), {:live_redirect, %{to: to, kind: String.to_atom(kind)}}}

          nil ->
            {:stop, proxy_topic(element), {:redirect, %{to: to}}}
        end

      true ->
        {:error, :invalid,
         "clicked link selected by #{inspect(element.selector)} does not have phx-click or href attributes"}
    end
  end

  defp maybe_event(type, node, element) when type in [:keyup, :keydown] do
    cond do
      event = DOM.attribute(node, "phx-#{type}") ->
        {:ok, event}

      event = DOM.attribute(node, "phx-window-#{type}") ->
        {:ok, event}

      true ->
        {:error, :invalid,
         "element selected by #{inspect(element.selector)} does not have " <>
           "phx-#{type} or phx-window-#{type} attributes"}
    end
  end

  defp maybe_event(type, node, element) do
    if event = DOM.attribute(node, "phx-#{type}") do
      {:ok, event}
    else
      {:error, :invalid,
       "element selected by #{inspect(element.selector)} does not have phx-#{type} attribute"}
    end
  end

  defp maybe_enabled(_type, {tag, _, _}, %{form_data: form_data})
       when tag != "form" and form_data != nil do
    {:error, :invalid,
     "a form element was given but the selected node is not a form, got #{inspect(tag)}}"}
  end

  defp maybe_enabled(type, node, element) do
    if DOM.attribute(node, "disabled") do
      {:error, :invalid,
       "cannot #{type} element #{inspect(element.selector)} because it is disabled"}
    else
      :ok
    end
  end

  defp maybe_values(:hook, _node, _element), do: {:ok, %{}}

  defp maybe_values(type, {tag, _, _} = node, element) when type in [:change, :submit] do
    if tag == "form" do
      defaults =
        node
        |> DOM.all("input, select, textarea")
        |> Enum.reverse()
        |> Enum.reduce(%{}, &form_defaults/2)

      case fill_in_map(Enum.to_list(element.form_data || %{}), "", node, []) do
        {:ok, value} -> {:ok, DOM.deep_merge(defaults, value)}
        {:error, _, _} = error -> error
      end
    else
      {:error, :invalid, "phx-#{type} is only allowed in forms, got #{inspect(tag)}"}
    end
  end

  defp maybe_values(_type, node, _element) do
    {:ok, DOM.all_values(node)}
  end

  defp form_defaults(node, acc) do
    cond do
      DOM.attribute(node, "disabled") -> acc
      name = DOM.attribute(node, "name") -> form_defaults(node, name, acc)
      true -> acc
    end
  end

  defp form_defaults({"select", _, _} = node, name, acc) do
    options = DOM.all(node, "option")

    all_selected =
      if DOM.attribute(node, "multiple") do
        Enum.filter(options, &DOM.attribute(&1, "selected"))
      else
        List.wrap(Enum.find(options, &DOM.attribute(&1, "selected")) || List.first(options))
      end

    all_selected
    |> Enum.reverse()
    |> Enum.reduce(acc, fn selected, acc ->
      Plug.Conn.Query.decode_pair({name, DOM.attribute(selected, "value")}, acc)
    end)
  end

  defp form_defaults({"textarea", _, [value]}, name, acc) do
    Plug.Conn.Query.decode_pair({name, value}, acc)
  end

  defp form_defaults({"input", _, _} = node, name, acc) do
    type = DOM.attribute(node, "type") || "text"
    value = DOM.attribute(node, "value") || ""

    cond do
      type in ["radio", "checkbox"] ->
        if DOM.attribute(node, "checked") do
          Plug.Conn.Query.decode_pair({name, value}, acc)
        else
          acc
        end

      type in ["image", "submit"] ->
        acc

      true ->
        Plug.Conn.Query.decode_pair({name, value}, acc)
    end
  end

  defp fill_in_map([{key, value} | rest], prefix, node, acc) do
    key = to_string(key)

    case fill_in_type(value, fill_in_name(prefix, key), node) do
      {:ok, value} -> fill_in_map(rest, prefix, node, [{key, value} | acc])
      {:error, _, _} = error -> error
    end
  end

  defp fill_in_map([], _prefix, _node, acc) do
    {:ok, Map.new(acc)}
  end

  defp fill_in_type([{_, _} | _] = value, key, node), do: fill_in_map(value, key, node, [])
  defp fill_in_type(%_{} = value, key, node), do: fill_in_value(value, key, node)
  defp fill_in_type(%{} = value, key, node), do: fill_in_map(Map.to_list(value), key, node, [])
  defp fill_in_type(value, key, node), do: fill_in_value(value, key, node)

  @limited ["select", "multiple select", "checkbox", "radio", "hidden"]
  @forbidden ["submit", "image"]

  defp fill_in_value(non_string_value, name, node) do
    value = stringify(non_string_value, &to_string/1)
    name = if is_list(value), do: name <> "[]", else: name

    {types, dom_values} =
      node
      |> DOM.all("[name=#{inspect(name)}]:not([disabled])")
      |> collect_values([], [])

    limited? = Enum.all?(types, &(&1 in @limited))

    cond do
      calendar_value = calendar_value(types, non_string_value, name, node) ->
        {:ok, calendar_value}

      types == [] ->
        {:error, :invalid,
         "could not find non-disabled input, select or textarea with name #{inspect(name)} within:\n\n" <>
           DOM.inspect_html(DOM.all(node, "[name]"))}

      forbidden_type = Enum.find(types, &(&1 in @forbidden)) ->
        {:error, :invalid,
         "cannot provide value to #{inspect(name)} because #{forbidden_type} inputs are never submitted"}

      forbidden_value = limited? && value |> List.wrap() |> Enum.find(&(&1 not in dom_values)) ->
        {:error, :invalid,
         "value for #{hd(types)} #{inspect(name)} must be one of #{inspect(dom_values)}, " <>
           "got: #{inspect(forbidden_value)}"}

      true ->
        {:ok, value}
    end
  end

  @calendar_fields ~w(year month day hour minute second)a

  defp calendar_value([], %{calendar: _} = calendar_type, name, node) do
    @calendar_fields
    |> Enum.flat_map(fn field ->
      string_field = Atom.to_string(field)

      with value when not is_nil(value) <- Map.get(calendar_type, field),
           {:ok, string_value} <- fill_in_value(value, name <> "[" <> string_field <> "]", node) do
        [{string_field, string_value}]
      else
        _ -> []
      end
    end)
    |> case do
      [] -> nil
      pairs -> Map.new(pairs)
    end
  end

  defp calendar_value(_, _, _, _) do
    nil
  end

  defp collect_values([{"textarea", _, _} | nodes], types, values) do
    collect_values(nodes, ["textarea" | types], values)
  end

  defp collect_values([{"input", _, _} = node | nodes], types, values) do
    type = DOM.attribute(node, "type") || "text"

    if type in ["radio", "checkbox", "hidden"] do
      value = DOM.attribute(node, "value") || ""
      collect_values(nodes, [type | types], [value | values])
    else
      collect_values(nodes, [type | types], values)
    end
  end

  defp collect_values([{"select", _, _} = node | nodes], types, values) do
    options = node |> DOM.all("option") |> Enum.map(&(DOM.attribute(&1, "value") || ""))

    if DOM.attribute(node, "multiple") do
      collect_values(nodes, ["multiple select" | types], Enum.reverse(options, values))
    else
      collect_values(nodes, ["select" | types], Enum.reverse(options, values))
    end
  end

  defp collect_values([_ | nodes], types, values) do
    collect_values(nodes, types, values)
  end

  defp collect_values([], types, values) do
    {types, Enum.reverse(values)}
  end

  defp fill_in_name("", name), do: name
  defp fill_in_name(prefix, name), do: prefix <> "[" <> name <> "]"

  defp encode(:form, value), do: Plug.Conn.Query.encode(value)
  defp encode(_, value), do: value

  defp stringify_type(:hook, value), do: stringify(value, & &1)
  defp stringify_type(_, value), do: stringify(value, &to_string/1)

  defp stringify(%{__struct__: _} = struct, fun),
    do: stringify_value(struct, fun)

  defp stringify(%{} = params, fun),
    do: Enum.into(params, %{}, &stringify_kv(&1, fun))

  defp stringify([{_, _} | _] = params, fun),
    do: Enum.into(params, %{}, &stringify_kv(&1, fun))

  defp stringify(params, fun) when is_list(params),
    do: Enum.map(params, &stringify(&1, fun))

  defp stringify(other, fun),
    do: stringify_value(other, fun)

  defp stringify_value(other, fun), do: fun.(other)
  defp stringify_kv({k, v}, fun), do: {to_string(k), stringify(v, fun)}
end
