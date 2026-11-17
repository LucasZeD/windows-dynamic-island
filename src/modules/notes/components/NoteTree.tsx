import {
	CheckIcon,
	ChevronRightIcon,
	FilePlusIcon,
	FileTextIcon,
	FolderIcon,
	FolderOpenIcon,
	FolderPlusIcon,
	PencilIcon,
	Trash2Icon,
} from "lucide-react";
import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "../../../core/cn";
import { useT } from "../../../core/i18n";
import { NOTES_ACCENT, type NoteNode, parentOf } from "../types";

export interface TreeActions {
	open: (path: string) => void;
	create: (parent: string, dir: boolean) => void;
	rename: (path: string, name: string) => void;
	remove: (path: string) => void;
	move: (path: string, toFolder: string) => void;
	toggle: (path: string) => void;
}

interface Props {
	tree: NoteNode[];
	active: string | null;
	expanded: string[];
	/** Path whose name is being edited (a note just created starts this way). */
	renaming: string | null;
	setRenaming: (path: string | null) => void;
	actions: TreeActions;
}

/** A row being dragged to another folder. */
interface Drag {
	path: string;
	dir: boolean;
	x: number;
	y: number;
	started: boolean;
	/** Folder under the pointer ("" = the top), if it can take the row. */
	target: string | null;
}

const DRAG_START_PX = 4;

/** Folders and notes, Obsidian-style: click opens, drag moves, hover shows actions. */
export function NoteTree({ tree, active, expanded, renaming, setRenaming, actions }: Props) {
	const t = useT();
	const [drag, setDrag] = useState<Drag | null>(null);
	const dragRef = useRef<Drag | null>(null);
	dragRef.current = drag;

	function onPointerDown(e: PointerEvent, node: NoteNode) {
		if (e.button !== 0 || renaming) return;
		setDrag({ path: node.path, dir: node.dir, x: e.clientX, y: e.clientY, started: false, target: null });
	}

	// The drag follows the pointer anywhere in the window.
	// biome-ignore lint/correctness/useExhaustiveDependencies: listeners live for one drag
	useEffect(() => {
		if (!drag) return;
		const move = (e: globalThis.PointerEvent) => {
			const d = dragRef.current;
			if (!d) return;
			if (!e.buttons) return setDrag(null); // released outside the window
			const far = Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG_START_PX;
			if (!d.started && !far) return;
			const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-folder]");
			const folder = el?.dataset.folder ?? null;
			const ok =
				folder !== null && folder !== parentOf(d.path) && folder !== d.path && !folder.startsWith(`${d.path}/`);
			setDrag({ ...d, started: true, target: ok ? folder : null });
		};
		const up = () => {
			const d = dragRef.current;
			setDrag(null);
			if (!d) return;
			if (!d.started) {
				if (!d.dir) actions.open(d.path);
			} else if (d.target !== null) actions.move(d.path, d.target);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		return () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};
	}, [drag !== null]);

	const dragging = drag?.started ? drag : null;

	return (
		<div
			className={cn(
				"notes-scroll flex min-h-0 flex-1 flex-col overflow-y-auto pb-6",
				dragging?.target === "" && "rounded-lg bg-white/5",
			)}
			data-folder=""
		>
			{tree.length === 0 && <p className="px-2 py-3 text-[12px] text-text-faint">{t("notes.emptyTree")}</p>}
			{tree.map((node) => (
				<TreeRow
					key={node.path}
					node={node}
					depth={0}
					active={active}
					expanded={expanded}
					renaming={renaming}
					setRenaming={setRenaming}
					actions={actions}
					dragging={dragging}
					onPointerDown={onPointerDown}
				/>
			))}
		</div>
	);
}

interface RowProps {
	node: NoteNode;
	depth: number;
	active: string | null;
	expanded: string[];
	renaming: string | null;
	setRenaming: (path: string | null) => void;
	actions: TreeActions;
	dragging: Drag | null;
	onPointerDown: (e: PointerEvent, node: NoteNode) => void;
}

function TreeRow(props: RowProps) {
	const { node, depth, active, expanded, renaming, setRenaming, actions, dragging, onPointerDown } = props;
	const t = useT();
	const [confirm, setConfirm] = useState(false);
	const open = node.dir && expanded.includes(node.path);
	const isActive = !node.dir && node.path === active;
	const isRenaming = renaming === node.path;
	const dropHere = node.dir && dragging?.target === node.path;
	const beingDragged = dragging?.path === node.path;

	useEffect(() => {
		if (!confirm) return;
		const timer = window.setTimeout(() => setConfirm(false), 3000);
		return () => window.clearTimeout(timer);
	}, [confirm]);

	const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
	const Icon = node.dir ? (open ? FolderOpenIcon : FolderIcon) : FileTextIcon;

	return (
		<div data-folder={node.dir ? node.path : undefined}>
			<div
				className={cn(
					"group flex h-6.5 cursor-default items-center gap-1 rounded-md pr-1 text-[12.5px] select-none",
					isActive ? "bg-white/10 text-text" : "text-text-dim hover:bg-white/6 hover:text-text",
					dropHere && "bg-white/12 ring-1 ring-white/25",
					beingDragged && "opacity-40",
				)}
				style={{ paddingLeft: 4 + depth * 12 }}
				onPointerDown={(e) => !isRenaming && onPointerDown(e, node)}
				onClick={() => node.dir && !isRenaming && actions.toggle(node.path)}
				onDoubleClick={() => setRenaming(node.path)}
				title={node.path}
			>
				{node.dir ? (
					<ChevronRightIcon
						size={12}
						className={cn("flex-none text-text-faint transition-transform duration-150", open && "rotate-90")}
					/>
				) : (
					<span className="w-3 flex-none" />
				)}
				<Icon size={13} className="flex-none" color={isActive ? NOTES_ACCENT : undefined} />
				{isRenaming ? (
					<RenameInput
						initial={node.name}
						onDone={(name) => {
							setRenaming(null);
							if (name && name !== node.name) actions.rename(node.path, name);
						}}
					/>
				) : (
					<span className="min-w-0 flex-1 truncate">{node.name}</span>
				)}
				{!isRenaming && (
					<span
						className={cn("flex flex-none items-center gap-0.5", !confirm && "hidden group-hover:flex")}
						onPointerDown={stop}
						onClick={stop}
						onDoubleClick={stop}
					>
						{node.dir && !confirm && (
							<>
								<RowButton title={t("notes.newNote")} onClick={() => actions.create(node.path, false)}>
									<FilePlusIcon size={12} />
								</RowButton>
								<RowButton title={t("notes.newFolder")} onClick={() => actions.create(node.path, true)}>
									<FolderPlusIcon size={12} />
								</RowButton>
							</>
						)}
						{!confirm && (
							<RowButton title={t("notes.rename")} onClick={() => setRenaming(node.path)}>
								<PencilIcon size={12} />
							</RowButton>
						)}
						<RowButton
							title={confirm ? t("notes.confirmDelete") : t("notes.delete")}
							danger
							onClick={() => {
								if (confirm) actions.remove(node.path);
								setConfirm(!confirm);
							}}
						>
							{confirm ? <CheckIcon size={12} /> : <Trash2Icon size={12} />}
						</RowButton>
					</span>
				)}
			</div>
			{open && node.children.map((c) => <TreeRow key={c.path} {...props} node={c} depth={depth + 1} />)}
		</div>
	);
}

function RowButton({
	title,
	danger,
	onClick,
	children,
}: {
	title: string;
	danger?: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			title={title}
			className={cn(
				"grid size-5 place-items-center rounded text-text-faint hover:bg-white/10 hover:text-text",
				danger && "hover:bg-[rgba(255,95,87,0.14)] hover:text-danger",
			)}
			onClick={onClick}
		>
			{children}
		</button>
	);
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
	const input = useRef<HTMLInputElement>(null);
	const done = useRef(false);
	useEffect(() => {
		input.current?.focus();
		input.current?.select();
	}, []);
	const finish = (name: string | null) => {
		if (done.current) return;
		done.current = true;
		onDone(name?.trim() || null);
	};
	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		e.stopPropagation();
		if (e.key === "Enter") finish(e.currentTarget.value);
		else if (e.key === "Escape") finish(null);
	};
	return (
		<input
			ref={input}
			defaultValue={initial}
			spellCheck={false}
			className="h-5 min-w-0 flex-1 rounded bg-white/10 px-1 text-[12.5px] text-text outline-none select-text"
			onKeyDown={onKeyDown}
			onBlur={(e) => finish(e.currentTarget.value)}
			onPointerDown={(e) => e.stopPropagation()}
		/>
	);
}
