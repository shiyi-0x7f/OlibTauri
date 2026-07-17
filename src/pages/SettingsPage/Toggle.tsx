export default function Toggle({ active, onClick }: { active: boolean; onClick: () => void }) {
    return (
        <div className={`toggle ${active ? "active" : ""}`} onClick={onClick}>
            <div className="toggle-knob" />
        </div>
    );
}
